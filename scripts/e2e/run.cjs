/**
 * E2E 冒烟测试运行器
 *
 * 用法: npm run build && npm run e2e
 *
 * 自动: 拉起 vite preview(4173) + 无头 Chromium(9222) → 依次执行套件 → 清理进程。
 * Chrome 路径: 环境变量 E2E_CHROME，或自动探测 Playwright 缓存。
 */
const { spawn } = require('child_process')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const PREVIEW_PORT = 4173
const CDP_PORT = 9222

function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME
  // Windows 常见安装位置（Edge 内核与 Chromium 行为一致）
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  const root = path.join(os.homedir(), '.cache', 'ms-playwright')
  try {
    const dirs = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell'))
    for (const d of dirs) {
      const bin = path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
      if (fs.existsSync(bin)) return bin
    }
    // mac/win 路径兜底
    for (const d of fs.readdirSync(root)) {
      const sub = path.join(root, d)
      for (const f of fs.readdirSync(sub, { withFileTypes: true })) {
        const cand = path.join(sub, f.name, process.platform === 'darwin' ? 'chrome-headless-shell' : 'chrome-headless-shell.exe')
        if (fs.existsSync(cand)) return cand
      }
    }
  } catch {}
  throw new Error('未找到无头 Chromium，请设置 E2E_CHROME=/path/to/chrome')
}

function waitHttp(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      http_get(url)
        .then(resolve)
        .catch(() => (Date.now() - start > timeoutMs ? reject(new Error('等待超时: ' + url)) : setTimeout(tick, 300)))
    }
    tick()
  })
}

function http_get(url) {
  return new Promise((resolve, reject) => {
    require(url.startsWith('https') ? 'https' : 'http').get(url, r => {
      r.resume()
      r.statusCode < 400 ? resolve() : reject(new Error('HTTP ' + r.statusCode))
    }).on('error', reject)
  })
}

/** 端口是否空闲（用于检测上次 e2e 的残留进程） */
function isPortFree(port) {
  return new Promise(resolve => {
    const net = require('net')
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function main() {
  // 端口占用检查：上次 e2e 残留的 Chrome/preview 会让本次连到旧页面，直接给出明确提示
  for (const [name, port] of [['preview', PREVIEW_PORT], ['CDP', CDP_PORT]]) {
    if (!(await isPortFree(port))) {
      console.error(`[e2e] 端口 ${port}（${name}）已被占用，可能是上次运行残留，请先结束占用进程`)
      process.exit(1)
    }
  }

  // 可用 E2E_SUITES=core,master 选择性运行
  const wanted = (process.env.E2E_SUITES || '').split(',').map(s => s.trim()).filter(Boolean)
  const suites = ['core', 'training', 'rating', 'master', 'roles', 'mobile']
    .filter(f => wanted.length === 0 || wanted.includes(f))
    .map(f => require(path.join(__dirname, `${f}.cjs`)))
  const procs = []

  // 1. preview server（直接用 node 跑 vite，避免 npm/shell 在不同环境下的差异）
  console.log('[e2e] 启动 preview server…')
  const rootDir = path.join(__dirname, '..', '..')
  procs.push(spawn(process.execPath, [path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PREVIEW_PORT)], {
    cwd: rootDir,
    stdio: 'ignore',
    detached: true,
  }))
  await waitHttp(`http://localhost:${PREVIEW_PORT}/`)

  // 2. headless chrome（一次性临时 profile，保证测试环境干净）
  console.log('[e2e] 启动无头 Chromium…')
  const chromeBin = findChrome()
  const userDataDir = path.join(os.tmpdir(), `xiangqi-e2e-${Date.now()}`)
  procs.push(spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-breakpad',
    '--disable-component-update', '--disable-background-networking',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `http://localhost:${PREVIEW_PORT}`,
  ], { stdio: 'ignore', detached: true }))

  let exitCode = 0
  let ctx = null
  try {
    await waitHttp(`http://localhost:${CDP_PORT}/json/list`)
    await new Promise(r => setTimeout(r, 1500))

    const { connect, waitEngineReady } = require(path.join(__dirname, 'lib.cjs'))
    ctx = await connect(CDP_PORT)
    // 无头 Chromium 默认视口 800×600 会触发移动端布局（<860px），
    // 用 CDP Emulation 显式设为桌面视口，保证桌面向 e2e 套件在桌面布局下运行（移动套件自行切换）。
    await ctx.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    await new Promise(r => setTimeout(r, 300))

    console.log('[e2e] 等待引擎就绪…')
    if (!(await waitEngineReady(ctx))) throw new Error('引擎未就绪')

    // 逐套件执行（共享同一页面状态）
    let failed = false
    for (const suite of suites) {
      console.log(`\n[e2e] 套件: ${suite.name}`)
      const ok = await suite.run(ctx)
      if (!ok) failed = true
    }
    exitCode = failed ? 1 : 0
  } catch (e) {
    console.error('[e2e] 运行失败:', e.message)
    exitCode = 1
  } finally {
    // 先让浏览器自己体面退出（Edge/Chrome 的启动器进程会先退出，
    // 只靠 taskkill 父 pid 会漏掉真正持有 9222 的子进程）
    if (ctx) {
      try {
        await Promise.race([ctx.send('Browser.close'), new Promise(r => setTimeout(r, 1500))])
      } catch {}
    }
    // Windows 下 process.kill(-pid) 不会杀进程树，改用 taskkill /T
    for (const p of procs) {
      try {
        if (process.platform === 'win32') execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' })
        else process.kill(-p.pid, 'SIGKILL')
      } catch {
        try { p.kill('SIGKILL') } catch {}
      }
    }
    // 兜底：按本轮唯一 profile 目录清理可能残留的浏览器进程
    if (process.platform === 'win32') {
      try {
        execSync(
          `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${userDataDir}*' -and ($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
          { stdio: 'ignore' },
        )
      } catch {}
    }
  }

  console.log(exitCode === 0 ? '\n[e2e] 全部通过 ✓' : '\n[e2e] 存在失败 ✗')
  process.exit(exitCode)
}

main()
