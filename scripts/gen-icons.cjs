/**
 * 生成安卓启动器图标（黄色主题）
 * 用法: npm run icons   （自动拉起 preview + 无头 Chrome，结束后清理）
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res')
const LEGACY = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 }
const FORE = { 'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432 }

function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME
  const root = path.join(os.homedir(), '.cache', 'ms-playwright')
  for (const d of fs.readdirSync(root)) {
    if (!d.startsWith('chromium_headless_shell')) continue
    const bin = path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
    if (fs.existsSync(bin)) return bin
  }
  throw new Error('未找到 Chrome，设置 E2E_CHROME 环境变量')
}

function http_get(url) {
  return new Promise((resolve, reject) => {
    require('http').get(url, r => { r.resume(); resolve() }).on('error', reject)
  })
}

async function main() {
  const procs = []
  procs.push(spawn('npm', ['run', 'preview', '--', '--port', '4173'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', detached: true }))
  const userDataDir = path.join(os.tmpdir(), `xiangqi-icons-${Date.now()}`)
  procs.push(spawn(findChrome(), ['--headless', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=9223',
    'http://localhost:4173'], { stdio: 'ignore', detached: true }))

  try {
    for (let i = 0; i < 50; i++) {
      try { await http_get('http://localhost:9223/json/list'); break } catch { await new Promise(r => setTimeout(r, 300)) }
    }
    await new Promise(r => setTimeout(r, 1200))

    const { connect } = require(path.join(__dirname, 'e2e', 'lib.cjs'))
    const ctx = await connect(9223)

    const drawFn = `(function(size, mode){
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#F7C948'); grad.addColorStop(1, '#DDA416');
      if (mode !== 'fg') {
        g.fillStyle = grad;
        if (mode === 'round') { g.beginPath(); g.arc(size/2, size/2, size/2, 0, Math.PI*2); g.fill(); }
        else {
          const r = size * 0.22;
          g.beginPath();
          g.moveTo(r, 0);
          g.arcTo(size, 0, size, size, r); g.arcTo(size, size, 0, size, r);
          g.arcTo(0, size, 0, 0, r); g.arcTo(0, 0, size, 0, r);
          g.closePath(); g.fill();
        }
      }
      const cx = size/2, cy = size/2, R = size * (mode === 'fg' ? 0.30 : 0.36);
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI*2); g.fillStyle = '#FFF6DE'; g.fill();
      g.lineWidth = Math.max(1.5, size*0.032); g.strokeStyle = '#B45309'; g.stroke();
      g.beginPath(); g.arc(cx, cy, R - size*0.055, 0, Math.PI*2);
      g.lineWidth = Math.max(1, size*0.012); g.stroke();
      g.fillStyle = '#B45309';
      g.font = 'bold ' + Math.round(R*1.15) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('帅', cx, cy + size*0.01);
      return cv.toDataURL('image/png').split(',')[1];
    })`

    const getB64 = (size, mode) => ctx.evalJs(`(${drawFn})(${size}, '${mode}')`)

    let count = 0
    for (const [dir, size] of Object.entries(LEGACY)) {
      for (const [suffix, mode] of [['ic_launcher.png', 'square'], ['ic_launcher_round.png', 'round']]) {
        const b64 = await getB64(size, mode)
        fs.writeFileSync(path.join(RES, dir, suffix), Buffer.from(b64, 'base64'))
        count++
      }
    }
    for (const [dir, size] of Object.entries(FORE)) {
      const b64 = await getB64(size, 'fg')
      fs.writeFileSync(path.join(RES, dir, 'ic_launcher_foreground.png'), Buffer.from(b64, 'base64'))
      count++
    }

    // 自适应图标底色改为琥珀黄
    const bgXml = path.join(RES, 'values', 'ic_launcher_background.xml')
    fs.writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F6C445</color>\n</resources>\n`)

    console.log(`[icons] 已生成 ${count} 个 PNG + 背景色`)
  } finally {
    for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL') } catch { p.kill('SIGKILL') } }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
