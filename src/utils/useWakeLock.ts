/**
 * 屏幕常亮（Screen Wake Lock）
 *
 * 对局思考、自动播放复盘时保持屏幕不熄灭；切到后台自动释放，回到前台重新申请。
 * 浏览器/WebView 不支持时静默降级，不影响其他功能。
 */
import { useEffect } from 'react'

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener?: (type: 'release', cb: () => void) => void
}

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const nav = navigator as WakeLockNavigator
    if (!nav.wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let disposed = false

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      try {
        sentinel = await nav.wakeLock!.request('screen')
      } catch {
        // 电量低 / 权限策略 / 非用户手势触发时会拒绝，忽略即可
        sentinel = null
      }
    }

    const release = () => {
      if (!sentinel) return
      const s = sentinel
      sentinel = null
      void s.release().catch(() => {})
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
      else release()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [enabled])
}
