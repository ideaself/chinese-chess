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

  // ── 层级导航：页头「←」/ 浏览器返回逐层弹出，根层双击退出提示 ──
  await evalJs(`(() => { const s = window.__store.getState(); s.setTab('games'); s.setSheetTab('games'); s.setGamesSubTab('mistakes'); })()`)
  await sleep(500)
  check('打开错题本子页', await evalJs(`window.__store.getState().gamesSubTab`) === 'mistakes')
  await evalJs(`document.querySelector('.mobile-overlay-back')?.click()`)
  await sleep(300)
  check('「←」先回子级父层（棋谱列表）', await evalJs(`window.__store.getState().gamesSubTab`) === 'list')
  // 子级被消费但面板仍在：占位记录应已补回，浏览器返回此时应关面板
  await evalJs(`history.back()`)
  await sleep(500)
  check('浏览器返回关闭覆盖层（右滑等价）', !(await evalJs(`!!document.querySelector('.mobile-overlay')`)))
  // 再来一遍：直接从面板层用浏览器返回
  await evalJs(`(() => { const s = window.__store.getState(); s.setSheetTab('games'); })()`)
  await sleep(500)
  await evalJs(`history.back()`)
  await sleep(500)
  check('再次浏览器返回关闭覆盖层', !(await evalJs(`!!document.querySelector('.mobile-overlay')`)))
  // 根层：先回「对战」Tab，再按才提示双击退出
  await evalJs(`window.__store.getState().navigateBack()`)
  await sleep(300)
  check('非对战 Tab 返回回棋盘主页', await evalJs(`window.__store.getState().activeTab`) === 'play')
  await evalJs(`window.__store.getState().navigateBack()`)
  await sleep(300)
  const rootToast = await evalJs(`document.querySelector('.toast')?.textContent || ''`)
  check('根层返回提示「再按一次退出」', rootToast.includes('再按一次退出'), rootToast)
  await sleep(2300) // 等双击窗口过期，避免影响后续用例

  // 复盘模式：5 键操作条 + 局势图/分析/报告 Tab 区 + 标题进度
  await evalJs(`(() => { const s = window.__store.getState(); s.loadGameObject(s.game); })()`)
  await sleep(400)
  check('复盘模式显示 5 键操作条', await evalJs(`!!document.querySelector('.mpb-five')`))
  check('复盘页显示 Tab 区（局势图/分析/报告）', await evalJs(`!!document.querySelector('.replay-tabs')`))
  check('局势图渲染（空态或曲线）', await evalJs(`!!document.querySelector('.eval-curve-empty') || !!document.querySelector('.eval-curve-svg')`))
  const replayTitle = await evalJs(`document.querySelector('.replay-title')?.textContent || ''`)
  check('复盘标题含进度 (n/总)', /\(\d+\/\d+\)/.test(replayTitle), replayTitle)
  await evalJs(`[...document.querySelectorAll('.replay-tab')].find(b => b.textContent === '报告')?.click()`)
  await sleep(250)
  check('报告 Tab 渲染（空态按钮或报告体）', await evalJs(`!!document.querySelector('.report-panel') || !!document.querySelector('.report-accuracy') || !!document.querySelector('.eval-curve-empty')`))
  await evalJs(`[...document.querySelectorAll('.replay-tab')].find(b => b.textContent === '局势图')?.click()`)
  await sleep(200)

  // 分支推演（试走变化）回归：曾因 Hooks 顺序问题（useEffect 位于 early return 之后）导致白屏，
  // 入口在「菜单」弹层。确认点击后棋盘仍可见且出现推演操作条。
  await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.title === '菜单')?.click()`)
  await sleep(250)
  await evalJs(`[...document.querySelectorAll('.mpb-pop-menu button')].find(b => b.textContent.includes('试走变化'))?.click()`)
  await sleep(400)
  const boardAfterVariation = await evalJs(`!!document.querySelector('.board-container svg')`)
  check('试走变化后棋盘仍可见（无白屏回归）', boardAfterVariation)
  const hasVarTransport = await evalJs(`!!document.querySelector('.mpb-transport')`)
  check('试走变化后出现推演操作条', hasVarTransport)
  // 退出推演回到复盘操作条
  await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.textContent.includes('退出推演'))?.click()`)
  await sleep(300)
  const backToReplay = await evalJs(`!!document.querySelector('.mpb-five')`)
  check('退出推演回到复盘操作条', backToReplay)

  // 自我分析：引擎横幅 + 实时出分 + 退出
  await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.title === '自我分析')?.click()`)
  await sleep(500)
  check('自我分析横幅出现', await evalJs(`!!document.querySelector('.self-banner')`))
  check('自我分析进入推演操作条', await evalJs(`!!document.querySelector('.mpb-transport')`))
  let engineScored = false
  for (let i = 0; i < 16; i++) {
    await sleep(400)
    if (await evalJs(`/深度\\d/.test(document.querySelector('.self-meta')?.textContent || '')`)) { engineScored = true; break }
  }
  check('自我分析引擎实时出分（深度/广度/速度）', engineScored)
  await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.textContent.includes('退出自我分析'))?.click()`)
  await sleep(300)
  check('退出自我分析回复盘操作条', await evalJs(`!!document.querySelector('.mpb-five') && !document.querySelector('.self-banner')`))

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
    await evalJs(`[...document.querySelectorAll('.mpb-btn')].find(b => b.title === '菜单')?.click()`)
    await sleep(250)
    await evalJs(`[...document.querySelectorAll('.mpb-pop-menu button')].find(b => b.textContent.includes('试走变化'))?.click()`)
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
