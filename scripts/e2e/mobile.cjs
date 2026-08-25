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

  // 还原桌面视口，避免影响后续套件
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  await sleep(400)

  console.log(`   移动端布局: ${results.pass} 通过 / ${results.fail} 失败`)
  return results.fail === 0
}

module.exports = { name: '移动端布局（底部栏/覆盖层/操作条）', run }
