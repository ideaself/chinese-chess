/**
 * 套件: 棋力等级 — 终局结算 / 结果页展示 / 设置页棋力卡片
 */
const path = require('path')

async function run(ctx) {
  const { evalJs, sleep, check, results } = ctx

  // 开一局人机对局（入门难度，玩家执红）
  await evalJs(`window.__store.getState().startNewGame('beginner', 'w')`)
  await sleep(400)

  // 走一步棋（避免空局不保存），随后求和 → 和棋终局
  await evalJs(`window.__store.getState().tryMove({ col: 7, row: 2 }, { col: 4, row: 2 })`)
  await sleep(600)
  await evalJs(`window.__store.getState().offerDraw()`)
  await sleep(600)

  const s1 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    return {
      result: s.game.result,
      change: s.lastRatingChange,
      history: JSON.parse(localStorage.getItem('xiangqi_rating') || '{}').history?.length ?? 0,
      modal: document.querySelector('.rating-change-line')?.textContent || null,
      difficultyHeader: s.game.header.Difficulty || null,
    }
  })())`))

  check('开局写入难度头', s1.difficultyHeader === 'beginner', s1.difficultyHeader)
  check('求和后终局并结算棋力分', s1.result === '1/2-1/2' && !!s1.change, JSON.stringify(s1.change))
  check('初始分 1200，对入门 AI 和棋扣 16 分', s1.change && s1.change.before === 1200 && s1.change.after === 1184 && s1.change.delta === -16,
    JSON.stringify(s1.change))
  check('结算历史写入 localStorage', s1.history === 1, String(s1.history))
  check('结果页显示棋力分变化', (s1.modal || '').includes('棋力分'), s1.modal)

  // 同局重复保存不重复结算
  await evalJs(`window.__store.getState().saveCurrentGame()`)
  await sleep(300)
  const dup = await evalJs(`JSON.parse(localStorage.getItem('xiangqi_rating')).history.length`)
  check('同局去重（重复保存不再计分）', dup === 1, String(dup))

  // 第二局再和棋（验证累计走势与二次结算）
  await evalJs(`window.__store.getState().restart()`)
  await sleep(300)
  await evalJs(`window.__store.getState().tryMove({ col: 7, row: 2 }, { col: 4, row: 2 })`)
  await sleep(600)
  await evalJs(`window.__store.getState().offerDraw()`)
  await sleep(600)
  const s2 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const s = window.__store.getState()
    return { change: s.lastRatingChange, n: JSON.parse(localStorage.getItem('xiangqi_rating')).history.length }
  })())`))
  check('第二局继续结算（1184→1168）', s2.change && s2.change.before === 1184 && s2.change.after === 1168 && s2.n === 2,
    JSON.stringify(s2))

  // 设置页棋力卡片
  await evalJs(`[...document.querySelectorAll('.tab-btn')].find(b => b.textContent === '设置')?.click()`)
  await sleep(400)
  const card = JSON.parse(await evalJs(`JSON.stringify((() => {
    const badge = document.querySelector('.rank-badge')?.textContent || null
    const value = document.querySelector('.rating-value')?.textContent || null
    const hint = document.querySelector('.rating-card .panel-hint')?.textContent || null
    const spark = !!document.querySelector('.sparkline polyline')
    return { badge, value, hint, spark }
  })())`))
  check('棋力卡片显示当前分数', card.value === '1168', card.value)
  check('段位徽章正确', card.badge === '七级棋士', card.badge)
  check('晋级提示存在', (card.hint || '').includes('六级棋士'), card.hint)
  check('走势折线渲染', card.spark)

  console.log(`   棋力等级: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '棋力等级（Elo 结算/展示）', run }
