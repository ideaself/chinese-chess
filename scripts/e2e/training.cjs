/**
 * 套件: 训练与推演 — 开局训练 / 变化树 / 摆棋清空
 */
const path = require('path')
const { connect } = require(path.join(__dirname, 'lib.cjs'))

async function run(ctx) {
  const { evalJs, sleep, check, results } = ctx

  // ── 摆棋清空保留双王 ──
  await evalJs(`window.__store.getState().enterSetup()`)
  await sleep(250)
  await evalJs(`(() => { const s = window.__store.getState(); s.setSetupTool({ kind: 'piece', piece: 'P' }); s.setupClick({ col: 0, row: 5 }) })()`)
  await evalJs(`window.__store.getState().clearSetupBoard()`)
  await sleep(200)
  const kings = JSON.parse(await evalJs(`JSON.stringify((() => {
    const b = window.__store.getState().board.board
    const out = []
    for (let c = 0; c < 9; c++) for (let r = 0; r < 10; r++) if (b[c][r] !== '.') out.push(b[c][r] + '@' + c + ',' + r)
    return out
  })())`))
  check('摆棋清空保留双王', kings.length === 2 && kings.includes('K@4,0') && kings.includes('k@4,9'), JSON.stringify(kings))
  await evalJs(`window.__store.getState().exitSetup()`)
  await sleep(200)

  // ── 变化树: 导入→快速分析→推演 ──
  const TEST_PGN = `[Event "测试对局"]\n[Red "玩家"]\n[Black "中级"]\n[Result "1-0"]\n\n1. 炮二平五 马2进3\n2. 马二进三 马8进7\n3. 车一平二 车9平8\n4. 兵七进一 卒3进1\n5. 马八进九 象7进5\n1-0`
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
  await evalJs(`window.__store.getState().setDifficulty('beginner')`)
  await evalJs(`window.__store.getState().analyzeCurrentGame()`)
  check('整盘分析完成', (await evalJs(`window.__store.getState().game.analysisStatus`)) === 'complete')

  const vStart = await evalJs(`(() => {
    const s = window.__store.getState()
    const idx = s.game.plies.findIndex(p => p.analysis?.pv?.length > 0)
    if (idx < 0) return 'NO_PV'
    s.enterVariationFromPly(idx)
    const v = window.__store.getState().variation
    const line = v ? (v.currentId === null ? v.mainLine : v.branches.find(b => b.id === v.currentId)) : null
    return line ? line.moves.length : 'NO_VARIATION'
  })()`)
  check('进入主变推演', typeof vStart === 'number' && vStart > 0, String(vStart))

  if (typeof vStart === 'number') {
    await evalJs(`window.__store.getState().variationGo(Math.min(2, ${vStart}))`)
    await sleep(200)
    const idx = await evalJs(`window.__store.getState().variation.currentPly`)
    check('推演步进', idx === Math.min(2, vStart), String(idx))
    await evalJs(`window.__store.getState().exitVariation()`)
    await sleep(200)
    check('退出恢复', (await evalJs(`window.__store.getState().variation`)) === null)
  }

  console.log(`   训练与推演: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '训练与推演（开局/变化/摆棋）', run }
