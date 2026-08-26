/**
 * 套件: 对局角色 — 双人对战 / AI 演示 / 随机执子（sideControl 行为）
 */
const path = require('path')
const { connect } = require(path.join(__dirname, 'lib.cjs'))

async function run(ctx) {
  const { evalJs, sleep, check } = ctx

  // 进入对战页签，开双人局
  await evalJs(`window.__store.getState().setTab('play')`)
  await sleep(200)
  await evalJs(`window.__store.getState().startNewGame('medium', 'w', { w: 'human', b: 'human' })`)
  await sleep(400)

  let s = JSON.parse(await evalJs(`JSON.stringify((() => {
    const st = window.__store.getState()
    return { mode: st.mode, sc: st.sideControl,
      red: st.game.header.Red, black: st.game.header.Black, event: st.game.header.Event }
  })())`))
  check('双人开局角色', s.sc.w === 'human' && s.sc.b === 'human', JSON.stringify(s))
  check('双人对局头信息', s.red === '玩家一' && s.black === '玩家二' && s.event === '双人对战', JSON.stringify(s))

  // 双人各走一步（直接 tryMove：炮二平五 / 马2进3）
  await evalJs(`window.__store.getState().tryMove({ col: 7, row: 7 }, { col: 4, row: 7 })`)
  await sleep(250)
  await evalJs(`window.__store.getState().tryMove({ col: 1, row: 9 }, { col: 2, row: 7 })`)
  await sleep(300)

  s = JSON.parse(await evalJs(`JSON.stringify((() => {
    const st = window.__store.getState()
    return { plies: st.game.plies.length, firstCn: st.game.plies[0]?.moveCn || null }
  })())`))
  check('双人双方均可落子', s.plies === 2 && s.firstCn === '炮二平五', JSON.stringify(s))

  // 双人悔棋 = 回退一手
  await evalJs(`window.__store.getState().undo()`)
  await sleep(250)
  const undoPlies = await evalJs(`window.__store.getState().game.plies.length`)
  check('双人悔棋回退一手', undoPlies === 1, String(undoPlies))

  // AI 回合禁止替走：开人机执红局，红先（人类），走完后轮到 AI，
  // 此时 selectPiece 应被拒绝（不产生 selected）
  await evalJs(`window.__store.getState().startNewGame('beginner', 'w')`)
  await sleep(300)
  await evalJs(`window.__store.getState().tryMove({ col: 7, row: 7 }, { col: 4, row: 7 })`)
  await sleep(150) // AI 尚在思考
  const aiTurnBlocked = await evalJs(`(() => {
    const st = window.__store.getState()
    if (st.board.turn !== 'b') return 'not-ai-turn'
    window.__store.getState().selectPiece({ col: 1, row: 9 })
    return window.__store.getState().selected === null ? 'blocked' : 'leaked'
  })()`)
  check('AI 回合拒绝选子', aiTurnBlocked === 'blocked', aiTurnBlocked)
  await sleep(2500) // 等 AI 走完，避免影响后续

  // 难度联动搜索深度（修复前 engineDepth 不随难度变化，AI 恒为 medium 深度）
  await evalJs(`window.__store.getState().setDifficulty('beginner')`)
  const dBeginner = await evalJs(`window.__store.getState().engineDepth`)
  await evalJs(`window.__store.getState().setDifficulty('grandmaster')`)
  const dGM = await evalJs(`window.__store.getState().engineDepth`)
  check('难度联动搜索深度', dBeginner === 2 && dGM === 28, `beginner=${dBeginner}, gm=${dGM}`)
  await evalJs(`window.__store.getState().setDifficulty('medium')`)

  // 回归：AI 必须走自己一方的子。曾因引擎「当前局面 FEN + 全部走法」被重复应用，
  // 导致引擎搜索到超前局面、AI 走了对方的子（用户实战第13手走了黑卒）。
  // 这里用真实对局前 12 手还原「红方轮走」局面，触发 AI(红) 走棋，校验所走之子确为红子。
  {
    const moves = [['h2','e2'],['b9','c7'],['h0','g2'],['h7','e7'],['c3','c4'],['h9','g7'],
      ['b2','c2'],['i9','h9'],['c4','c5'],['c6','c5'],['c2','c7'],['e7','e3']]
    await evalJs(`(function(){
      const st = window.__store.getState();
      st.startNewGame('beginner','w',{ w:'human', b:'human' });
      const mv = ${JSON.stringify(moves)};
      for (const m of mv) st.tryMove(
        { col: m[0].charCodeAt(0)-97, row: +m[0][1] },
        { col: m[1].charCodeAt(0)-97, row: +m[1][1] });
      window.__store.setState({ sideControl: { w:'ai', b:'human' }, mode: 'play', isThinking: false });
      st.aiMove();
    })()`)
    let aiColor = 'pending'
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      aiColor = await evalJs(`(function(){
        const st = window.__store.getState();
        if (st.game.plies.length < 13 || st.isThinking) return 'pending';
        const ply = st.game.plies[12];
        const seg = ply.fenBefore.split(' ')[0].split('/')[9 - (+ply.move[1])];
        let exp = ''; for (const c of seg) exp += isNaN(+c) ? c : '1'.repeat(+c);
        const pc = exp[ply.move.charCodeAt(0)-97];
        const isRed = pc === pc.toUpperCase() && pc !== pc.toLowerCase();
        return (ply.turn === 'w' && isRed) ? 'red-ok' : ('WRONG:' + ply.turn + ':' + pc);
      })()`)
      if (aiColor !== 'pending') break
    }
    check('AI 只走自己一方的子（不误走对方子）', aiColor === 'red-ok', aiColor)

  // 回归：快评与 AI 搜索的并发串扰。曾因 quickEval 不标记 isThinking、且无时间上限，
  // 高级别下快评占住引擎数秒，玩家快速回手后 AI 并发下发 go，旧搜索的 bestmove
  // 被误当 AI 着法应用（AI 走对方子）。仅高级别复现（低级别快评瞬间结束）。
  {
    const moves = [['h2','e2'],['b9','c7'],['h0','g2'],['h7','e7'],['c3','c4'],['h9','g7'],
      ['b2','c2'],['i9','h9'],['c4','c5'],['c6','c5'],['c2','c7'],['e7','e3']]
    await evalJs(`window.__store.getState().setDifficulty('grandmaster')`)
    await evalJs(`(function(){
      const st = window.__store.getState();
      st.startNewGame('grandmaster','w',{ w:'human', b:'human' });
      const mv = ${JSON.stringify(moves)};
      for (const m of mv) st.tryMove(
        { col: m[0].charCodeAt(0)-97, row: +m[0][1] },
        { col: m[1].charCodeAt(0)-97, row: +m[1][1] });
      window.__store.setState({ sideControl: { w:'ai', b:'human' }, mode: 'play', isThinking: false });
    })()`)
    // 先触发快评（特级大师深度 16），等它真正结束后再触发 AI 走棋
    await evalJs(`window.__store.getState().quickEval()`)
    let qeDone = false
    for (let i = 0; i < 40 && !qeDone; i++) { await sleep(250); qeDone = await evalJs(`!window.__store.getState().engineOccupied`) }
    check('高级别快评限时归还引擎（≤8s）', qeDone, String(qeDone))
    await evalJs(`window.__store.getState().aiMove()`)
    let aiColor2 = 'pending'
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      aiColor2 = await evalJs(`(function(){
        const st = window.__store.getState();
        if (st.game.plies.length < 13 || st.isThinking) return 'pending';
        const ply = st.game.plies[12];
        const seg = ply.fenBefore.split(' ')[0].split('/')[9 - (+ply.move[1])];
        let exp = ''; for (const c of seg) exp += isNaN(+c) ? c : '1'.repeat(+c);
        const pc = exp[ply.move.charCodeAt(0)-97];
        const isRed = pc === pc.toUpperCase() && pc !== pc.toLowerCase();
        return (ply.turn === 'w' && isRed) ? 'red-ok' : ('WRONG:' + ply.turn + ':' + pc);
      })()`)
      if (aiColor2 !== 'pending') break
    }
    check('快评后 AI 仍只走自己一方的子', aiColor2 === 'red-ok', aiColor2)
    // 等引擎彻底空闲（AI 落子后的自动快评可能仍在占用），避免影响后续用例
    for (let i = 0; i < 40; i++) {
      const busy = await evalJs(`window.__store.getState().engineOccupied || window.__store.getState().isThinking`)
      if (!busy) break
      await sleep(250)
    }
    await evalJs(`window.__store.getState().setDifficulty('medium')`)
  }
  }

  // 提示：天天象棋风格 — 棋盘上画带序号的三步箭头，不占用布局
  await evalJs(`window.__store.getState().startNewGame('medium', 'w')`)
  for (let i = 0; i < 40; i++) {
    if (await evalJs(`window.__store.getState().engineReady`)) break
    await sleep(250)
  }
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('提示'))?.click()`)
  let mv = 0
  for (let i = 0; i < 40; i++) {
    mv = await evalJs(`(window.__store.getState().hintInfo?.movesUci || []).length`)
    if (mv >= 3) break
    await sleep(200)
  }
  const arrows = await evalJs(`document.querySelectorAll('.hint-arrows g').length`)
  const hintText = await evalJs(`document.querySelector('.board-hint-overlay')?.textContent || ''`)
  check('提示返回三步着法', mv >= 3, `moves=${mv}`)
  check('提示在棋盘画三步箭头', arrows === mv && mv >= 3, `arrows=${arrows}, moves=${mv}`)
  check('提示含三步中文变化', (hintText.match(/→/g) || []).length === 2, hintText)

  // AI 演示：双 AI 自动行棋
  await evalJs(`window.__store.getState().startNewGame('beginner', 'w', { w: 'ai', b: 'ai' })`)
  await sleep(4500)
  s = JSON.parse(await evalJs(`JSON.stringify((() => {
    const st = window.__store.getState()
    return { plies: st.game.plies.length, sc: st.sideControl,
      red: st.game.header.Red, event: st.game.header.Event }
  })())`))
  check('AI 演示自动行棋', s.sc.w === 'ai' && s.sc.b === 'ai' && s.plies >= 2, JSON.stringify(s))
  check('演示局头信息', s.red !== '玩家' && s.event === 'AI 对弈演示', JSON.stringify(s))

  // 演示局不入棋谱库：saveCurrentGame 后 savedGames 无新增
  const beforeCount = await evalJs(`window.__store.getState().savedGames.length`)
  await evalJs(`window.__store.getState().saveCurrentGame()`)
  await sleep(300)
  const afterCount = await evalJs(`window.__store.getState().savedGames.length`)
  check('演示局不入棋谱库', beforeCount === afterCount, `${beforeCount}→${afterCount}`)

  // 收尾回到普通人机局
  await evalJs(`window.__store.getState().startNewGame('medium', 'w')`)
  await sleep(300)

  const { results } = ctx
  console.log(`   对局角色: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '对局角色（双人/AI演示/防替走）', run }
