/**
 * 层级导航 / 返回手势核心
 *
 * 三条入口汇入同一 navigateBack（uiSlice）：
 *   1. 安卓系统返回键 / 边缘右滑 → @capacitor/app backButton（原生）
 *   2. 手机浏览器右滑           → popstate（Web/PWA，开层时占一条历史记录）
 *   3. 页面内「←」按钮          → 直接调用
 *
 * 历史记录约定：任意顶层覆盖层打开期间，恰好占一条占位记录；
 * 子级页不单独占位——返回时先消费已注册的子级 handler，再由 syncLayers 维持占位不变。
 */

type BackHandler = () => boolean

const handlers: BackHandler[] = []

/** 当前历史占位是否存活 */
let placeholder = false
/** 忽略接下来 N 次 popstate（程序化 history.back 的回声） */
let suppressPop = 0
/** App 上次同步的层数 */
let synced = 0

let navigateBackImpl: (() => void) | null = null

export function initBackNav(navigateBack: () => void): void {
  if (navigateBackImpl) return
  navigateBackImpl = navigateBack
  window.addEventListener('popstate', () => {
    // 用户右滑/浏览器后退：占位已被浏览器消费
    if (suppressPop > 0) { suppressPop--; return }
    placeholder = false
    navigateBackImpl?.()
  })
}

export function registerBackHandler(h: BackHandler): () => void {
  handlers.push(h)
  return () => {
    const i = handlers.indexOf(h)
    if (i >= 0) handlers.splice(i, 1)
  }
}

/** 自栈顶向下询问子级 handler；有消费返回 true */
export function consumeTopBackHandler(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true
  }
  return false
}

/** App 层数变化时同步历史占位（打开→pushState，全关→back 并吞掉回声） */
export function syncLayers(count: number): void {
  const prev = synced
  synced = count
  if (count > 0 && prev === 0 && !placeholder) {
    placeholder = true
    try { history.pushState({ xqLayer: Date.now() }, '') } catch { /* ignore */ }
  } else if (count === 0 && prev > 0 && placeholder) {
    placeholder = false
    suppressPop++
    try { history.back() } catch { /* ignore */ }
  }
}

/** 子级被消费但顶层仍在：确保占位仍存在（右滑消费子级后被吞掉时补回） */
export function ensurePlaceholder(open: boolean): void {
  if (open && !placeholder) {
    placeholder = true
    try { history.pushState({ xqLayer: Date.now() }, '') } catch { /* ignore */ }
  }
}

export function hasOpenLayers(): boolean {
  return synced > 0
}

/** 原生退出应用（非原生环境静默忽略） */
export function exitAppNative(): void {
  import('@capacitor/app')
    .then(m => m.App.exitApp())
    .catch(() => {})
}
