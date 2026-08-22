/**
 * 棋力等级（Elo + 段位）回归测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_RATING,
  expectedScore,
  kFactor,
  computeNewRating,
  applyGameResult,
  getRatingState,
  resetRating,
  getRank,
} from '../rating'

// ── localStorage stub ──
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

describe('Elo 计算', () => {
  it('初始分为 1200，无历史', () => {
    expect(getRatingState()).toEqual({ rating: DEFAULT_RATING, history: [] })
  })

  it('期望胜率：同分为 0.5，分差越大期望越低', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5)
    expect(expectedScore(1200, 2300)).toBeLessThan(0.05)
    expect(expectedScore(2300, 1200)).toBeGreaterThan(0.95)
  })

  it('K 值：定级期 40 → 之后按分段递减', () => {
    expect(kFactor(1200, 0)).toBe(40)
    expect(kFactor(1200, 14)).toBe(40)
    expect(kFactor(1200, 15)).toBe(24)
    expect(kFactor(1999, 50)).toBe(24)
    expect(kFactor(2000, 50)).toBe(16)
  })

  it('战胜强敌涨分多于负于弱敌的扣分（同 K 下对称性合理）', () => {
    const win = computeNewRating(1200, 2300, 'win', 0)   // ≈ +40
    const loss = computeNewRating(1200, 800, 'loss', 0)  // ≈ -36
    expect(win - 1200).toBeGreaterThan(35)
    expect(1200 - loss).toBeGreaterThan(30)
    expect(win - 1200).toBeGreaterThan(1200 - loss)
  })

  it('同分对手和棋分数不变', () => {
    expect(computeNewRating(1500, 1500, 'draw', 20)).toBe(1500)
  })

  it('爆冷取胜收益高于稳赢弱旅', () => {
    const upset = computeNewRating(1200, 2300, 'win', 0)
    const steady = computeNewRating(2400, 800, 'win', 100)
    expect(upset - 1200).toBeGreaterThan(steady - 2400)
  })
})

describe('终局结算 applyGameResult', () => {
  it('胜利后分数上升且写入历史', () => {
    const r = applyGameResult('g1', 'grandmaster', 'win')
    expect(r).not.toBeNull()
    expect(r!.after).toBeGreaterThan(r!.before)
    expect(getRatingState().history[0].gameId).toBe('g1')
    expect(getRatingState().rating).toBe(r!.after)
  })

  it('同一 gameId 只结算一次', () => {
    applyGameResult('g1', 'medium', 'win')
    const before = getRatingState()
    expect(applyGameResult('g1', 'medium', 'win')).toBeNull()
    expect(getRatingState()).toEqual(before)
  })

  it('连败会降分且历史新→旧排列', () => {
    applyGameResult('a', 'beginner', 'loss')
    applyGameResult('b', 'beginner', 'loss')
    const s = getRatingState()
    expect(s.rating).toBeLessThan(DEFAULT_RATING)
    expect(s.history.map(h => h.gameId)).toEqual(['b', 'a'])
  })

  it('非法难度拒绝结算', () => {
    // @ts-expect-error 故意传非法难度
    expect(applyGameResult('x', 'cheat', 'win')).toBeNull()
  })
})

describe('段位表 getRank', () => {
  it('低分对应初学乍练', () => {
    const r = getRank(500)
    expect(r.tier.name).toBe('初学乍练')
    expect(r.next?.name).toBe('十级棋士')
  })

  it('边界值归属正确', () => {
    expect(getRank(1700).tier.name).toBe('一级棋士')
    expect(getRank(1699).tier.name).toBe('二级棋士')
  })

  it('进度在 0..1 之间，到顶为 1', () => {
    expect(getRank(850).progress).toBeCloseTo(0.5)
    expect(getRank(2500).next).toBeNull()
    expect(getRank(2500).progress).toBe(1)
    expect(getRank(2500).tier.name).toBe('象棋大师')
  })

  it('toNext 与进度一致', () => {
    const r = getRank(1250)
    expect(r.toNext).toBe(1300 - 1250)
  })
})

describe('重置', () => {
  it('resetRating 后回到初始状态', () => {
    applyGameResult('g1', 'hard', 'win')
    resetRating()
    expect(getRatingState()).toEqual({ rating: DEFAULT_RATING, history: [] })
  })
})
