package com.m.xiangqi;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

/**
 * 原生 Pikafish 引擎插件（独立进程 + UCI 行协议）。
 *
 * JS 侧契约见 src/engine/pikafish.ts：
 *   start({})                → { binary, netPath }
 *   send({ command })        → 向引擎 stdin 写一行
 *   quit()                   → 结束引擎进程
 *   addListener('stdout', { line }) → 引擎 stdout 逐行回调
 *
 * 引擎与 NNUE 权重随 APK 放在 assets/public/engine/（由仓库 public/engine/ 经 cap sync 同步），
 * 首次启动解压到 filesDir 并赋可执行权限；之后按文件大小跳过重复解压。
 * 插件不可用或启动失败时，JS 侧会自动回退 WASM 引擎。
 */
@CapacitorPlugin(name = "NativePikafish")
public class NativePikafishPlugin extends Plugin {
    private static final String TAG = "NativePikafish";
    private static final String ASSET_DIR = "public/engine";
    private static final String NNUE_NAME = "pikafish.nnue";
    /** 引擎二进制以 jniLibs 形式打包（Android 10+ 禁止执行应用数据目录里的文件） */
    private static final String SO_DOTPROD = "libpikafish.so";
    private static final String SO_BASELINE = "libpikafish_baseline.so";

    private Process process;
    private Writer stdin;
    private Thread readerThread;
    private File netFile;

    @PluginMethod
    public void start(PluginCall call) {
        try {
            stopEngine();

            File dir = new File(getContext().getFilesDir(), "engine");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("无法创建引擎目录: " + dir);
            }

            String soName = deviceHasDotProd() ? SO_DOTPROD : SO_BASELINE;
            File bin = new File(getContext().getApplicationInfo().nativeLibraryDir, soName);
            if (!bin.exists()) {
                throw new IOException("原生引擎未随 APK 打包: " + bin.getAbsolutePath());
            }
            // NNUE 权重体积大且无需执行权限，仍放 assets 解压到 filesDir
            netFile = extractAsset(ASSET_DIR + "/" + NNUE_NAME, new File(dir, NNUE_NAME), false);

            ProcessBuilder pb = new ProcessBuilder(bin.getAbsolutePath());
            pb.directory(dir);
            pb.redirectErrorStream(true);
            process = pb.start();

            stdin = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8);
            startReader(process);

            Log.i(TAG, "原生引擎已启动: " + bin.getAbsolutePath() + " net=" + netFile.getAbsolutePath());
            JSObject ret = new JSObject();
            ret.put("binary", bin.getAbsolutePath());
            ret.put("netPath", netFile.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "启动原生引擎失败", e);
            call.reject("启动原生引擎失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String command = call.getString("command");
        if (command == null) {
            call.reject("缺少 command");
            return;
        }
        if (stdin == null) {
            call.reject("引擎未启动");
            return;
        }
        try {
            stdin.write(command);
            stdin.write("\n");
            stdin.flush();
            call.resolve();
        } catch (IOException e) {
            call.reject("写入引擎失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void quit(PluginCall call) {
        stopEngine();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopEngine();
        super.handleOnDestroy();
    }

    private void startReader(final Process proc) {
        readerThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        JSObject data = new JSObject();
                        data.put("line", line);
                        notifyListeners("stdout", data);
                    }
                } catch (IOException e) {
                    Log.w(TAG, "引擎输出读取结束: " + e.getMessage());
                }
            }
        }, "pikafish-reader");
        readerThread.setDaemon(true);
        readerThread.start();
    }

    private void stopEngine() {
        try {
            if (stdin != null) {
                stdin.write("quit\n");
                stdin.flush();
            }
        } catch (IOException ignored) {
            // 进程可能已退出
        }
        stdin = null;
        if (process != null) {
            process.destroy();
            process = null;
        }
        if (readerThread != null) {
            readerThread.interrupt();
            readerThread = null;
        }
    }

    /** 把 assets 里的文件解压到目标路径；大小一致则跳过（NNUE 有 53MB，不宜每次重写） */
    private File extractAsset(String assetPath, File dest, boolean executable) throws IOException {
        try {
            long assetSize = getContext().getAssets().openFd(assetPath).getLength();
            if (dest.exists() && dest.length() == assetSize) {
                if (executable) dest.setExecutable(true);
                return dest;
            }
        } catch (IOException ignored) {
            // openFd 对压缩资源不可用（如 NNUE），走全量复制
        }

        try (InputStream in = getContext().getAssets().open(assetPath);
             FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        }
        if (executable) dest.setExecutable(true);
        return dest;
    }

    /** 设备 CPU 是否支持 dotprod（Pikafish 的 armv8-dotprod 版本更快） */
    private boolean deviceHasDotProd() {
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(new FileInputStream("/proc/cpuinfo"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("Features") && line.contains("asimddp")) return true;
            }
        } catch (IOException e) {
            Log.w(TAG, "读取 cpuinfo 失败: " + e.getMessage());
        }
        return false;
    }
}
