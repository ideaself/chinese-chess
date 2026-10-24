/**
 * 套件: 移动端流程（v1.24+ 首页/对战/底栏/设置/时间制）
 *
 * 覆盖真实用户路径：首页 → 对战 → 走子 → 悔棋 → 提示 → 返回首页 →
 * 设置（拖动开关）→ 新对局（时间制）→ 认输。
 * 另外回归 v1.24.1 的「评估条高度变化导致棋盘抖动」。
 */
const path = require('path')
const { connect } = require(path.join(__dirname, 'lib.cjs'))

async function run(ctx) {
  const { send, evalJs, sleep, check, results } = ctx

  // 移动端视口
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, isMobile: true,
  })
  await sleep(400)

  /** 回到首页并保证是经典皮肤（坐标换算依赖经典网格） */
  async function resetToHome() {
    await evalJs(`(() => {
      const s = window.__store.getState()
      s.updateSettings({ pieceStyle: 'classic', boardStyle: 'classic', dragToMove: false })
      s.restart()
      s.setSheetTab(null)
      s.setMobilePage('home')
    })()`)
    await sleep(600)
  }

  /** 点击棋盘交点（board 坐标：row0 = 红方底线） */
  async function tapCell(col, row) {
    const rect = await evalJs(`(() => {
      const r = document.querySelector('.board-container svg').getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })()`)
    const x = rect.x + (40 + col * 60) / 560 * rect.w
    const y = rect.y + (40 + (9 - row) * 60) / 620 * rect.h
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(320)
  }

  const barButton = (label) => `
    (() => {
      const b = [...document.querySelectorAll('.mpb-ibtn')].find(x => (x.textContent || '').includes('${label}'))
      if (b) { b.click(); return true } return false
    })()`

  await resetToHome()

  // ── 首页 ──
  check('首页显示三个入口', (await evalJs(`document.querySelectorAll('.mobile-home-btn').length`)) === 3)
  check('首页有每日一题卡片', await evalJs(`!!document.querySelector('.mobile-home-daily')`))
  check('首页不再显示重复顶栏', !(await evalJs(`!!document.querySelector('.app-header')`)))

  await evalJs(`[...document.querySelectorAll('.mobile-home-btn')].find(b => b.textContent.includes('对战'))?.click()`)
  await sleep(900)

  // ── 对战页 ──
  check('进入对战页', (await evalJs(`window.__store.getState().mobilePage`)) === 'play')
  check('底栏为 5 个图标按钮', (await evalJs(`document.querySelectorAll('.mpb-ibtn').length`)) === 5)
  check('页头有返回首页按钮', await evalJs(`!!document.querySelector('.mobile-header-row .mobile-page-back')`))
  check('页头有走棋方状态胶囊', await evalJs(`!!document.querySelector('.turn-chip')`))

  // ── 走子 + 评估条高度回归 ──
  const yBefore = await evalJs(`document.querySelector('.board-container svg').getBoundingClientRect().y`)
  await tapCell(7, 2)   // 炮二
  await tapCell(4, 2)   // 平五
  await sleep(2500)
  const plies = await evalJs(`window.__store.getState().game.plies.length`)
  check('点击走子生效', plies >= 1, `plies=${plies}`)
  const yAfter = await evalJs(`document.querySelector('.board-container svg').getBoundingClientRect().y`)
  check('走子后棋盘不位移（评估条高度恒定）', Math.abs(yAfter - yBefore) < 1, `${yBefore} → ${yAfter}`)

  // ── 悔棋 ──
  await evalJs(barButton('悔棋'))
  await sleep(700)
  check('悔棋回到自己行棋前', (await evalJs(`window.__store.getState().game.plies.length`)) === 0)

  // ── 提示 ──
  await evalJs(barButton('提示'))
  let hintShown = false
  for (let i = 0; i < 20; i++) {
    hintShown = await evalJs(`!!document.querySelector('.hint-arrows') || !!window.__store.getState().hintInfo`)
    if (hintShown) break
    await sleep(700)
  }
  check('提示给出箭头/推荐着', hintShown)

  // ── 页头返回首页 ──
  await evalJs(`document.querySelector('.mobile-header-row .mobile-page-back')?.click()`)
  await sleep(500)
  check('返回键回到首页', (await evalJs(`window.__store.getState().mobilePage`)) === 'home')

  // ── 设置：拖动开关 / 常亮 / 时间制 ──
  await evalJs(`[...document.querySelectorAll('.mobile-home-btn')].find(b => b.textContent.includes('设置'))?.click()`)
  await sleep(700)
  check('设置页有「拖动走子」', await evalJs(`[...document.querySelectorAll('.settings-row')].some(r => r.textContent.includes('拖动走子'))`))
  check('设置页有「屏幕常亮」', await evalJs(`[...document.querySelectorAll('.settings-row')].some(r => r.textContent.includes('屏幕常亮'))`))
  check('设置页有「时间制」', await evalJs(`[...document.querySelectorAll('.settings-row')].some(r => r.textContent.includes('时间制'))`))
  await evalJs(`(() => {
    const row = [...document.querySelectorAll('.settings-row')].find(r => r.textContent.includes('拖动走子'))
    row?.querySelector('input[type=checkbox]')?.click()
  })()`)
  await sleep(300)
  check('拖动开关可切换为开', (await evalJs(`window.__store.getState().settings.dragToMove`)) === true)
  await evalJs(`(() => {
    const row = [...document.querySelectorAll('.settings-row')].find(r => r.textContent.includes('拖动走子'))
    row?.querySelector('input[type=checkbox]')?.click()
  })()`)
  await sleep(200)
  check('拖动开关可切回关', (await evalJs(`window.__store.getState().settings.dragToMove`)) === false)

  // 设置页是全屏页：先返回首页，再进对战
  await evalJs(`document.querySelector('.mobile-page-back')?.click()`)
  await sleep(500)
  check('设置页返回首页', (await evalJs(`window.__store.getState().mobilePage`)) === 'home')

  // ── 新对局：时间制 5 分钟 ──
  await evalJs(`[...document.querySelectorAll('.mobile-home-btn')].find(b => b.textContent.includes('对战'))?.click()`)
  await sleep(700)
  await evalJs(barButton('更多'))
  await sleep(300)
  await evalJs(`[...document.querySelectorAll('.mpb-more-menu button')].find(b => b.textContent.includes('新对局'))?.click()`)
  await sleep(600)
  check('新对局面板打开', await evalJs(`!!document.querySelector('.newgame-sheet')`))
  await evalJs(`[...document.querySelectorAll('.newgame-sheet .btn')].find(b => b.textContent.trim() === '5 分钟')?.click()`)
  await sleep(200)
  await evalJs(`[...document.querySelectorAll('.newgame-sheet .btn')].find(b => b.textContent.includes('玩家执红'))?.click()`)
  await sleep(900)
  const tc = await evalJs(`window.__store.getState().timeControl`)
  check('新对局应用 5 分钟时间制', !!tc && tc.baseMs === 300000, JSON.stringify(tc))
  // 顶部那条是黑方（此刻不走棋），取最后一条 = 红方（行棋方）
  const timerOf = `[...document.querySelectorAll('.player-info .timer')].pop()?.textContent || ''`
  const timerText = await evalJs(timerOf)
  check('计时器显示剩余时间（倒计时）', /^0[45]:\d{2}$/.test(timerText), timerText)
  await sleep(1200)
  const timerText2 = await evalJs(timerOf)
  check('倒计时会走', timerText2 !== timerText, `${timerText} → ${timerText2}`)

  // ── 认输确认条 ──
  await evalJs(barButton('认输'))
  await sleep(400)
  check('认输弹出确认条', await evalJs(`!!document.querySelector('.mpb-confirm')`))
  await evalJs(`[...document.querySelectorAll('.mpb-confirm-actions .mpb-btn')].find(b => b.textContent.trim() === '认输')?.click()`)
  await sleep(600)
  check('认输后对局结束', (await evalJs(`window.__store.getState().game.result`)) !== '*')

  // 还原桌面视口，避免影响后续套件
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  await sleep(300)

  console.log(`   移动端流程: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '移动端流程（首页/对战/底栏/设置/时间制）', run }
