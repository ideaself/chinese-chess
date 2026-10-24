/**
 * 崩溃/异常日志（本地环形缓冲）
 *
 * 目的：Android 上白屏或闪退时，用户能一键复制最近的错误，而不是只说“打不开”。
 * 只存最近 50 条，不含棋谱/账号等隐私数据。
 */
export interface CrashEntry {
  /** 时间戳 */
  t: number
  /** 摘要 */
  msg: string
  /** 发生位置（组件名 / 模块） */
  where?: string
  /** 堆栈（截断到 2000 字） */
  stack?: string
}

const KEY = 'xiangqi_crash_log'
const MAX = 50

function read(): CrashEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is CrashEntry => !!x && typeof x.msg === 'string') : []
  } catch {
    return []
  }
}

export function logCrash(msg: string, where?: string, stack?: string): void {
  try {
    const entry: CrashEntry = {
      t: Date.now(),
      msg: String(msg).slice(0, 500),
      where: where?.slice(0, 120),
      stack: stack?.slice(0, 2000),
    }
    const list = [entry, ...read()].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // 存储不可用时忽略
  }
}

export function getCrashLog(): CrashEntry[] {
  return read()
}

export function clearCrashLog(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/** 导出为可直接粘贴的文本 */
export function crashLogText(): string {
  const list = read()
  if (!list.length) return '（无崩溃记录）'
  return list.map(e => {
    const time = new Date(e.t).toLocaleString()
    return `[${time}] ${e.where ? e.where + ': ' : ''}${e.msg}${e.stack ? `\n${e.stack}` : ''}`
  }).join('\n\n')
}

let installed = false

/** 安装全局错误监听（幂等）。已捕获的 React 错误也会经 ErrorBoundary 写入。 */
export function installGlobalErrorLogging(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    // 资源加载失败（img/script）没有 error 对象，单独记一条
    if (!e.error) {
      logCrash(e.message || '资源加载失败', e.target instanceof HTMLElement ? e.target.tagName : 'window')
      return
    }
    logCrash(e.message, e.filename ? `${e.filename}:${e.lineno}` : 'window', e.error?.stack)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    logCrash(
      r instanceof Error ? r.message : String(r),
      'unhandledrejection',
      r instanceof Error ? r.stack : undefined,
    )
  })
}
