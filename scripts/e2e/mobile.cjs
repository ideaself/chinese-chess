/**
 * 套件: 移动端布局 — 底部 Tab 栏 / 全屏覆盖层 / 棋盘主页操作条
 */
const path = require('path')
const { connect } = require(path.join(__dirname, 'lib.cjs'))

async function run(ctx) {
  const { send, evalJs, sleep, check, results } = ctx

  // 切到移动端视口（< 860px 触发 isMobile 分支；matchMedia change 会驱动重渲染）
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, isMobile: true })
  await sleep(500)

  const hasBottomBar = await evalJs(`!!document.querySelector('.bottom-bar')`)
  check('移动端底部 Tab 栏存在', hasBottomBar)

  const hasPlayBar = await evalJs(`!!document.querySelector('.mobile-play-bar')`)
  check('棋盘主页操作条存在', hasPlayBar)

  const sideHidden = await evalJs(`(() => { const el = document.querySelector('.side-panel'); return el ? getComputedStyle(el).display === 'none' : true; })()`)
  check('桌面侧栏在移动端不渲染', sideHidden)

  const boardHome = await evalJs(`!document.querySelector('.mobile-overlay')`)
  check('默认进入纯棋盘主页', boardHome)

  // 打开「棋谱」覆盖层
  await evalJs(`[...document.querySelectorAll('.bottom-tab')].find(b => b.textContent === '棋谱')?.click()`)
  await sleep(500)
  const overlayOpen = await evalJs(`!!document.querySelector('.mobile-overlay')`)
  check('点击棋谱出现覆盖层', overlayOpen)
  const title = await evalJs(`document.querySelector('.mobile-overlay-header')?.textContent || ''`)
  check('覆盖层标题含「棋谱库」', title.includes('棋谱库'), title)

  // 关闭覆盖层
  await evalJs(`document.querySelector('.mobile-overlay-close')?.click()`)
  await sleep(400)
  const overlayClosed = await evalJs(`!document.querySelector('.mobile-overlay')`)
  check('关闭覆盖层回到棋盘', overlayClosed)

  // 复盘模式：操作条应显示运输条
  await evalJs(`(() => { const s = window.__store.getState(); s.loadGameObject(s.game); })()`)
  await sleep(400)
  const hasTransport = await evalJs(`!!document.querySelector('.mpb-transport')`)
  check('复盘模式显示运输条', hasTransport)

  // 分支推演（试走变化）回归：曾因 Hooks 顺序问题（useEffect 位于 early return 之后）导致白屏，
  // 这里确认点击后棋盘仍可见且出现推演操作条。
  await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.title === '试走变化')?.click()`)
  await sleep(400)
  const boardAfterVariation = await evalJs(`!!document.querySelector('.board-container svg')`)
  check('试走变化后棋盘仍可见（无白屏回归）', boardAfterVariation)
  const hasVarTransport = await evalJs(`!!document.querySelector('.mpb-transport')`)
  check('试走变化后出现推演操作条', hasVarTransport)
  // 退出推演回到复盘操作条
  await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.textContent.includes('退出推演'))?.click()`)
  await sleep(300)
  const backToReplay = await evalJs(`!!document.querySelector('.mpb-transport')`)
  check('退出推演回到复盘操作条', backToReplay)

  // 大师库对局：黑方/红方应显示对战棋手名；试走变化不得白屏
  await evalJs(`[...document.querySelectorAll('.bottom-tab')].find(b => b.textContent === '棋谱')?.click()`)
  await sleep(300)
  await evalJs(`[...document.querySelectorAll('.sub-nav .filter-btn')].find(b => b.textContent === '大师库')?.click()`)
  let loaded = false
  for (let i = 0; i < 16; i++) {
    await sleep(500)
    if (await evalJs(`!!document.querySelector('.game-item')`)) { loaded = true; break }
  }
  if (loaded) {
    await evalJs(`document.querySelector('.game-item')?.click()`)
    await sleep(500)
    const names = await evalJs(`[...document.querySelectorAll('.player-name')].map(e => e.textContent).join(' | ')`)
    check('大师库对局显示棋手名（含角色标注）', names.includes('（'), names)
    await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.title === '试走变化')?.click()`)
    await sleep(400)
    check('大师库试走变化后棋盘仍可见', await evalJs(`!!document.querySelector('.board-container svg')`))
    await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.textContent.includes('退出推演'))?.click()`)
    await sleep(300)
  }

  // 还原桌面视口，避免影响后续套件
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  await sleep(400)

  console.log(`   移动端布局: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '移动端布局（底部栏/覆盖层/操作条）', run }
