#!/usr/bin/env node
/**
 * 原生 Pikafish 引擎集成（本地/CI 通用）
 *
 * `android/` 是 Capacitor 生成目录且不入库，原生引擎需要的三样东西必须在
 * `cap add android` 之后重新注入，本脚本负责这件事：
 *
 *   1. 引擎可执行文件 → android/app/src/main/jniLibs/arm64-v8a/
 *      （Android 10+ 禁止执行应用数据目录里的文件，只能走 nativeLibraryDir，
 *        因此命名为 lib*.so；配合 AndroidManifest 的 extractNativeLibs="true"）
 *   2. NNUE 权重 → public/engine/pikafish.nnue（随 assets 打包，插件解压到 filesDir）
 *   3. 插件源码 → android/app/src/main/java/com/m/xiangqi/
 *      并注册到 MainActivity；同时给 AndroidManifest 打上 extractNativeLibs
 *
 * 用法:
 *   node scripts/android-engine.mjs                # 默认从 ../Pikafish.2026-01-02 取
 *   node scripts/android-engine.mjs --src /path    # 指定引擎发行目录
 *   PIKAFISH_DIR=/path node scripts/android-engine.mjs
 *
 * 找不到引擎目录时不报错（退出码 0），仅提示——此时 App 自动回退 WASM 引擎。
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const engineSrc = resolve(arg('src', process.env.PIKAFISH_DIR || join(ROOT, '..', 'Pikafish.2026-01-02')))
const androidDir = join(ROOT, 'android')

if (!existsSync(androidDir)) {
  console.error('[android-engine] 未找到 android/，请先执行 npx cap add android')
  process.exit(1)
}

// ── 1. 引擎二进制 → jniLibs ────────────────────────────────────────
const jniDir = join(androidDir, 'app', 'src', 'main', 'jniLibs', 'arm64-v8a')
const BINARIES = [
  ['Android/pikafish-armv8-dotprod', 'libpikafish.so'],
  ['Android/pikafish-armv8', 'libpikafish_baseline.so'],
]

let injected = 0
if (existsSync(engineSrc)) {
  mkdirSync(jniDir, { recursive: true })
  for (const [rel, dest] of BINARIES) {
    const src = join(engineSrc, rel)
    if (!existsSync(src)) {
      console.warn(`[android-engine] 缺少 ${rel}，跳过`)
      continue
    }
    copyFileSync(src, join(jniDir, dest))
    chmodSync(join(jniDir, dest), 0o644)
    console.log(`[android-engine] ${rel} → jniLibs/arm64-v8a/${dest}`)
    injected++
  }

  // ── 2. NNUE → public/engine（随 assets 分发） ────────────────────
  const nnue = join(engineSrc, 'pikafish.nnue')
  if (existsSync(nnue)) {
    const dir = join(ROOT, 'public', 'engine')
    mkdirSync(dir, { recursive: true })
    copyFileSync(nnue, join(dir, 'pikafish.nnue'))
    console.log('[android-engine] pikafish.nnue → public/engine/')
  } else {
    console.warn('[android-engine] 缺少 pikafish.nnue，原生引擎会启动失败并回退 WASM')
  }
} else {
  console.warn(`[android-engine] 未找到引擎目录 ${engineSrc}`)
  console.warn('[android-engine] 跳过原生引擎注入（App 将回退 WASM 引擎）')
}

// ── 3. 插件源码 + MainActivity ─────────────────────────────────────
const pkgDir = join(androidDir, 'app', 'src', 'main', 'java', 'com', 'm', 'xiangqi')
if (injected > 0) {
  mkdirSync(pkgDir, { recursive: true })
  for (const f of ['NativePikafishPlugin.java', 'MainActivity.java']) {
    const src = join(ROOT, 'android-native', f)
    if (!existsSync(src)) continue
    copyFileSync(src, join(pkgDir, f))
    console.log(`[android-engine] android-native/${f} → ${pkgDir}`)
  }

  // ── 4. AndroidManifest: extractNativeLibs ────────────────────────
  const manifest = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml')
  let xml = readFileSync(manifest, 'utf-8')
  if (!xml.includes('extractNativeLibs')) {
    xml = xml.replace('<application', '<application\n        android:extractNativeLibs="true"')
    writeFileSync(manifest, xml)
    console.log('[android-engine] AndroidManifest 已加 extractNativeLibs="true"')
  }
  console.log('[android-engine] 完成：构建前记得 npm run build && npx cap sync android')
}
