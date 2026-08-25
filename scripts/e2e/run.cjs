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

async function main() {
  // 可用 E2E_SUITES=core,master 选择性运行
  const wanted = (process.env.E2E_SUITES || '').split(',').map(s => s.trim()).filter(Boolean)
  const suites = ['core', 'training', 'rating', 'master', 'roles', 'mobile']
    .filter(f => wanted.length === 0 || wanted.includes(f))
    .map(f => require(path.join(__dirname, `${f}.cjs`)))
  const procs = []

  // 1. preview server
  console.log('[e2e] 启动 preview server…')
  procs.push(spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT)], {
    cwd: path.join(__dirname, '..', '..'),
    stdio: 'ignore',
    detached: true,
  }))
  await waitHttp(`http://localhost:${PREVIEW_PORT}/`)

  // 2. headless chrome（一次性临时 profile，保证测试环境干净）
  console.log('[e2e] 启动无头 Chromium…')
  const chromeBin = findChrome()
  const userDataDir = path.join(os.tmpdir(), `xiangqi-e2e-${Date.now()}`)
  procs.push(spawn(chromeBin, [
    '--headless', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `http://localhost:${PREVIEW_PORT}`,
  ], { stdio: 'ignore', detached: true }))

  let exitCode = 0
  try {
    await waitHttp(`http://localhost:${CDP_PORT}/json/list`)
    await new Promise(r => setTimeout(r, 1500))

    const { connect, waitEngineReady } = require(path.join(__dirname, 'lib.cjs'))
    const ctx = await connect(CDP_PORT)
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
    for (const p of procs) {
      try { process.kill(-p.pid, 'SIGKILL') } catch { p.kill('SIGKILL') }
    }
  }

  console.log(exitCode === 0 ? '\n[e2e] 全部通过 ✓' : '\n[e2e] 存在失败 ✗')
  process.exit(exitCode)
}

main()
