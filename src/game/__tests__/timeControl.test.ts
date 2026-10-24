import { describe, it, expect } from 'vitest'
import {
  allowanceMs,
  clockDelta,
  formatClock,
  hasTimeControl,
  isLowTime,
  movesPlayedBy,
  NO_TIME_CONTROL,
  remainingMs,
  timeControlHeader,
} from '../timeControl'

const plies = (...turns: ('w' | 'b')[]) => ({ plies: turns.map(turn => ({ turn })) })

describe('时间制', () => {
  it('按行棋方统计已走着数', () => {
    const g = plies('w', 'b', 'w', 'b', 'w')
    expect(movesPlayedBy(g, 'w')).toBe(3)
    expect(movesPlayedBy(g, 'b')).toBe(2)
  })

  it('额度 = 基础 + 加秒 × 已走', () => {
    const tc = { baseMs: 600_000, incMs: 5_000 }
    expect(allowanceMs(tc, 0)).toBe(600_000)
    expect(allowanceMs(tc, 4)).toBe(620_000)
  })

  it('剩余时间不会为负', () => {
    const tc = { baseMs: 600_000, incMs: 5_000 }
    expect(remainingMs(tc, 100_000, 2)).toBe(510_000)
    expect(remainingMs(tc, 999_999, 2)).toBe(0)
  })

  it('不限时判定与 PGN 头', () => {
    expect(hasTimeControl(NO_TIME_CONTROL)).toBe(false)
    expect(hasTimeControl(null)).toBe(false)
    expect(hasTimeControl({ baseMs: 300_000, incMs: 0 })).toBe(true)
    expect(timeControlHeader({ baseMs: 600_000, incMs: 5_000 })).toBe('600+5')
    expect(timeControlHeader(NO_TIME_CONTROL)).toBeNull()
  })

  it('时钟格式：分秒 / 小时 / 读秒', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(59_000)).toBe('00:59')
    expect(formatClock(599_000)).toBe('09:59')
    expect(formatClock(3_600_000)).toBe('1:00:00')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(isLowTime(30_000)).toBe(true)
    expect(isLowTime(30_001)).toBe(false)
    expect(isLowTime(0)).toBe(false)
  })
})

  it('棋钟按真实时间差累计（后台节流后补回）', () => {
    expect(clockDelta(1000, 4000)).toBe(3000)
    expect(clockDelta(1000, 1000)).toBe(0)
    // 时钟回拨/负值按 0 处理
    expect(clockDelta(5000, 1000)).toBe(0)
  })

