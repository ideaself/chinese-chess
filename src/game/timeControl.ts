/**
 * 时间制（包干 + 每步加秒）
 *
 * 设计：棋钟仍然只记「已用时间」（redTime/blackTime 为累计毫秒），
 * 剩余时间 = 基础用时 + 加秒 × 该方已走着数 − 已用时间。
 * 这样不需要额外维护倒计时状态，悔棋后已用时间回退即可自然复原。
 */

export interface TimeControl {
  /** 基础用时（毫秒），0 表示不限时 */
  baseMs: number
  /** 每步加秒（毫秒） */
  incMs: number
}

/** 不限时（不启用棋钟） */
export const NO_TIME_CONTROL: TimeControl = { baseMs: 0, incMs: 0 }

export function hasTimeControl(tc: TimeControl | null | undefined): tc is TimeControl {
  return !!tc && tc.baseMs > 0
}

/** 某一方已走的着数（红/黑分别计数） */
export function movesPlayedBy(game: { plies: ReadonlyArray<{ turn: 'w' | 'b' }> }, side: 'w' | 'b'): number {
  let n = 0
  for (const p of game.plies) if (p.turn === side) n++
  return n
}

/** 某一方的总用时额度：基础用时 + 加秒 × 已走着数 */
export function allowanceMs(tc: TimeControl, moves: number): number {
  return tc.baseMs + Math.max(0, tc.incMs) * Math.max(0, moves)
}

/** 剩余时间（毫秒，不小于 0） */
export function remainingMs(tc: TimeControl, elapsedMs: number, moves: number): number {
  return Math.max(0, allowanceMs(tc, moves) - Math.max(0, elapsedMs))
}

/** 显示用：<1 小时 mm:ss，否则 h:mm:ss；超时显示 00:00 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 读秒（≤30 秒）时用醒目色 */
export function isLowTime(ms: number): boolean {
  return ms > 0 && ms <= 30_000
}

/**
 * 本次棋钟 tick 应补的毫秒数。
 *
 * 用「实际时间差」而不是固定 +1000：手机切后台后 WebView 的 setInterval 会被
 * 降频/挂起，固定 +1000 会让限时对局白白多出时间。回到前台后的第一跳会把
 * 真实间隔一次补上（时钟回拨/负值按 0 处理）。
 */
export function clockDelta(lastTickAt: number, now: number): number {
  const d = now - lastTickAt
  return d > 0 ? d : 0
}

/** PGN 头里的时间制写法，如 "600+5"（秒+秒） */
export function timeControlHeader(tc: TimeControl | null): string | null {
  if (!hasTimeControl(tc)) return null
  return `${Math.round(tc.baseMs / 1000)}+${Math.round(tc.incMs / 1000)}`
}
