import { describe, it, expect } from 'vitest'
import { perpetualCheckLoser } from '../rules'

// 红方将军：黑将 e9、红车 e1，轮到黑方且被将军
const RED_CHECK = '4k4/9/9/9/9/9/9/9/9/3KR4 b'
// 黑方将军：红帅 d1、黑车 d9，轮到红方且被将军
const BLACK_CHECK = '3r5/9/9/9/9/9/9/9/9/3K5 w'
// 轮到红方、双方都不被将军
const QUIET_W = '4k4/9/9/9/9/9/9/9/9/3K1R3 w'
// 轮到黑方、双方都不被将军
const QUIET_B = '4k4/9/9/9/9/9/9/9/9/3K5 b'

describe('长将判负', () => {
  it('红方连续三步将军、黑方没有 → 判红负', () => {
    const plies = [
      { turn: 'w' as const, fenAfter: RED_CHECK },
      { turn: 'b' as const, fenAfter: QUIET_W },
      { turn: 'w' as const, fenAfter: RED_CHECK },
      { turn: 'b' as const, fenAfter: QUIET_W },
      { turn: 'w' as const, fenAfter: RED_CHECK },
      { turn: 'b' as const, fenAfter: QUIET_W },
    ]
    expect(perpetualCheckLoser(plies)).toBe('w')
  })

  it('黑方连续将军 → 判黑负', () => {
    const plies = [
      { turn: 'b' as const, fenAfter: BLACK_CHECK },
      { turn: 'w' as const, fenAfter: QUIET_B },
      { turn: 'b' as const, fenAfter: BLACK_CHECK },
      { turn: 'w' as const, fenAfter: QUIET_B },
      { turn: 'b' as const, fenAfter: BLACK_CHECK },
      { turn: 'w' as const, fenAfter: QUIET_B },
    ]
    expect(perpetualCheckLoser(plies)).toBe('b')
  })

  it('双方都没将军 / 手数不足 → 不判', () => {
    expect(perpetualCheckLoser([])).toBeNull()
    expect(perpetualCheckLoser([
      { turn: 'w', fenAfter: QUIET_B },
      { turn: 'b', fenAfter: QUIET_W },
      { turn: 'w', fenAfter: QUIET_B },
      { turn: 'b', fenAfter: QUIET_W },
      { turn: 'w', fenAfter: QUIET_B },
      { turn: 'b', fenAfter: QUIET_W },
    ])).toBeNull()
  })
})
