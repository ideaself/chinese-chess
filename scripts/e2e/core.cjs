/**
 * 套件: 核心流程 — PGN 导入 / 复盘重放 / 列表点击 / 新对局
 */
const path = require('path')
const { connect } = require(path.join(__dirname, 'lib.cjs'))

const TEST_PGN = `[Event "测试对局"]\n[Red "玩家"]\n[Black "中级"]\n[Result "1-0"]\n\n1. 炮二平五 马2进3\n2. 马二进三 马8进7\n3. 车一平二 车9平8\n4. 兵七进一 卒3进1\n5. 马八进九 象7进5\n1-0`

async function run(ctx) {
  const { evalJs, sleep, check, results } = ctx

  // 导入
  await evalJs(`[...document.querySelectorAll('.tab-btn')].find(b => b.textContent === '棋谱')?.click()`)
  await sleep(300)
  await evalJs(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([${JSON.stringify(TEST_PGN)}], 't.pgn', { type: 'text/plain' }))
    const input = document.querySelector('[data-pgn-input]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(800)

  const s1 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    return { toast: document.querySelector('.toast')?.textContent || null, mode: s.mode,
      tab: s.activeTab, plies: s.game.plies.length, firstCn: s.game.plies[0]?.moveCn || null }
  })())`))
  check('导入后自动进入复盘', s1.mode === 'replay' && s1.tab === 'play' && s1.plies === 10, JSON.stringify(s1))
  check('导入反馈 toast', (s1.toast || '').includes('已导入'))
  check('首着中文记谱', s1.firstCn === '炮二平五', s1.firstCn)

  // 重放导航
  await evalJs(`window.__store.getState().goToStart()`)
  await sleep(150)
  const atStart = await evalJs(`window.__store.getState().currentPlyIndex`)
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.title === '下一步')?.click()`)
  await sleep(250)
  const afterFwd = await evalJs(`window.__store.getState().currentPlyIndex`)
  check('逐步导航 0→1', atStart === 0 && afterFwd === 1, `${atStart}→${afterFwd}`)

  // 列表点击进入
  await evalJs(`[...document.querySelectorAll('.tab-btn')].find(b => b.textContent === '棋谱')?.click()`)
  await sleep(300)
  await evalJs(`document.querySelector('.game-item')?.click()`)
  await sleep(500)
  const s3 = JSON.parse(await evalJs(`JSON.stringify({ mode: window.__store.getState().mode, tab: window.__store.getState().activeTab })`))
  check('列表点击进入复盘', s3.mode === 'replay' && s3.tab === 'play', JSON.stringify(s3))

  // 备份/容量行（需在棋谱页签下）
  await evalJs(`[...document.querySelectorAll('.tab-btn')].find(b => b.textContent === '棋谱')?.click()`)
  await sleep(300)
  const hasStorage = await evalJs(`!!document.querySelector('.storage-line')`)
  check('容量显示行存在', hasStorage)
  const hasBackupBtn = await evalJs(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('备份'))`)
  check('备份按钮存在', hasBackupBtn)

  console.log(`   核心流程: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '核心流程（导入/重放/列表）', run }
