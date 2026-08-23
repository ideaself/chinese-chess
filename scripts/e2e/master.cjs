/**
 * 套件: 大师库 — 分类加载 / 打开对局 / 分支推演 / 名局拆解
 */
const path = require('path')
const { connect } = require(path.join(__dirname, 'lib.cjs'))

async function run(ctx) {
  const { evalJs, sleep, check, results } = ctx

  // 套件起始状态复位：退出可能残留的模式
  await evalJs(`(() => {
    const s = window.__store.getState()
    if (s.variation) s.exitVariation()
    s.setGamesSubTab('library')
  })()`)
  await sleep(200)

  // 进入棋谱页 → 大师库子页签
  await evalJs(`[...document.querySelectorAll('.tab-btn')].find(b => b.textContent === '棋谱')?.click()`)
  await sleep(300)
  await evalJs(`window.__store.getState().setGamesSubTab('library')`)
  await sleep(1200)

  const s1 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const items = document.querySelectorAll('.master-library .game-item').length
    const header = document.querySelector('.master-library .panel-header')?.textContent || ''
    return { items, loaded: header.includes('已加载'), hasQuizBtn: header.includes('名局拆解') }
  })())`))
  check('大师库列表已加载分片', s1.items > 0, `items=${s1.items}`)
  check('显示已加载计数', s1.loaded)
  check('名局拆解入口存在', s1.hasQuizBtn)

  // 开局页签 + 胜率统计
  await evalJs(`(() => {
    const btns = [...document.querySelectorAll('.master-library button')]
    btns.find(b => b.textContent === '开局')?.click()
  })()`)
  await sleep(400)
  const hasStats = await evalJs(`!!document.querySelector('.lib-stats')`)
  check('开局胜率统计展示', hasStats)

  // 点击第一局打开复盘
  await evalJs(`window.__store.getState().setGamesSubTab('library')`)
  await sleep(400)
  const preClick = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    const lib = document.querySelector('.master-library')
    const chips = [...document.querySelectorAll('.master-library .controls-row .btn-active')].map(b => b.textContent)
    return { tab: s.activeTab, sub: s.gamesSubTab, mode: s.mode,
      items: document.querySelectorAll('.master-library .game-item').length,
      hint: document.querySelector('.master-library .panel-hint')?.textContent || null,
      activeChips: chips }
  })())`))
  console.log(`   [debug] 点击前: ${JSON.stringify(preClick)}`)
  await evalJs(`document.querySelector('.master-library .game-item')?.click()`)
  await sleep(800)
  const s2 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    return { mode: s.mode, plies: s.game.plies.length, src: s.game.header.Source || '',
      toast: document.querySelector('.toast')?.textContent || null }
  })())`))
  console.log(`   [debug] 点击后: ${JSON.stringify(s2)}`)
  check('大师对局进入复盘', s2.mode === 'replay' && s2.plies >= 40, JSON.stringify(s2))
  check('棋谱来源标记 dpxq', s2.src.startsWith('dpxq:'), s2.src)

  // 分支推演：进入试走模式并落一子
  const before = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    return { ply: s.currentPlyIndex, pieces: Object.values(s.board.board).flat().filter(p => p !== '.').length }
  })())`))
  await evalJs(`window.__store.getState().startReplayVariation()`)
  await sleep(200)
  // 通过 store 直接触发一次 tryMove（选第一个合法着法；同步执行）
  const moveResult = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    if (!s.variation) return { ok: false, why: 'no variation' }
    const legal = []
    for (let c = 0; c < 9; c++) for (let r = 0; r < 10; r++) {
      if (s.board.board[c][r] !== '.') {
        const ms = window.__getLegalMoves(s.board, c, r)
        for (const m of ms) legal.push([c, r, m.col, m.row])
      }
    }
    if (legal.length === 0) return { ok: false, why: 'no moves' }
    const [fc, fr, tc, tr] = legal[0]
    s.selectPiece({ col: fc, row: fr })
    const done = s.tryMove({ col: fc, row: fr }, { col: tc, row: tr })
    return { ok: done, branchLen: window.__store.getState().variation?.moves.length || 0 }
  })())`))
  check('推演分支落子成功', moveResult.ok === true && moveResult.branchLen === 1, JSON.stringify(moveResult))

  // 回到主线
  await evalJs(`window.__store.getState().exitVariation()`)
  await sleep(200)
  const afterExit = JSON.parse(await evalJs(`JSON.stringify({ variation: window.__store.getState().variation, ply: window.__store.getState().currentPlyIndex })`))
  check('退出推演回主线', afterExit.variation === null && afterExit.ply === before.ply, JSON.stringify(afterExit))

  // 名局拆解：出题/答题流程
  await evalJs(`window.__store.getState().startMasterQuiz()`)
  await sleep(600)
  const q1 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const q = window.__store.getState().masterQuiz
    return q ? { options: q.options.length, asking: q.status === 'asking', keyOnly: q.keyOnly } : null
  })())`))
  check('拆解出题成功', !!q1 && q1.options >= 2 && q1.asking, JSON.stringify(q1))

  // 直接答正确答案（从 store 拿 correct 验证判定逻辑）
  await evalJs(`(() => {
    const q = window.__store.getState().masterQuiz
    window.__store.getState().answerMasterQuiz(q.correct)
  })()`)
  await sleep(300)
  const q2 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const q = window.__store.getState().masterQuiz
    return { status: q.status, asked: q.asked, right: q.right }
  })())`))
  check('答对判定正确', q2.status === 'correct' && q2.right === 1 && q2.asked === 1, JSON.stringify(q2))

  // 战绩持久化
  const persisted = JSON.parse(await evalJs(`JSON.stringify((() => {
    const raw = localStorage.getItem('xiangqi_quiz_stats')
    return raw ? JSON.parse(raw) : null
  })())`))
  check('战绩写入存档', persisted && persisted.asked >= 1, JSON.stringify(persisted))

  // 错题本可见拆解区（先推进到下一题，再故意答错）
  const dbg = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    if (!s.masterQuiz || s.masterQuiz.status !== 'asking') {
      s.nextQuizPly()
    }
    const q = window.__store.getState().masterQuiz
    let answered = null
    if (q && q.status === 'asking') {
      const wrong = q.options.find(o => o !== q.correct)
      answered = wrong ? 'tried' : 'no-wrong-option'
      if (wrong) window.__store.getState().answerMasterQuiz(wrong)
    }
    const after = window.__store.getState().masterQuiz
    return { beforeStatus: q?.status || String(q), answered, after: { status: after?.status, ply: after?.ply } }
  })())`))
  console.log(`   [debug] 错题流程: ${JSON.stringify(dbg)}`)
  await sleep(300)
  const mistakesRaw = await evalJs(`localStorage.getItem('xiangqi_quiz_mistakes')`)
  const mistakeOk = (() => { try { return JSON.parse(mistakesRaw).length >= 1 } catch { return false } })()
  check('错题已收录', mistakeOk, mistakesRaw ? mistakesRaw.slice(0, 120) : 'null')

  await evalJs(`window.__store.getState().exitMasterQuiz()`)

  console.log(`   大师库与拆解: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '大师库（分类/复盘/分支推演/拆解）', run }
