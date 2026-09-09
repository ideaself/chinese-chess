/**
 * 评估分视角转换测试
 *
 * 回归背景：AnalysisPanel / CoachPanel 曾把行棋方视角的引擎分当红方视角渲染，
 * 黑方行棋时"红优/黑优"整体颠倒（AI 教练的形势判断前提也随之反了）。
 */
import { describe, it, expect } from 'vitest'
import { toRedScore, fenTurn, redScoreFromFen } from '../evalScore'

describe('evalScore 视角转换', () => {
  it('红方行棋保持原值，黑方行棋取负', () => {
    expect(toRedScore(120, 'w')).toBe(120)
    expect(toRedScore(120, 'b')).toBe(-120)
    expect(toRedScore(-80, 'w')).toBe(-80)
    expect(toRedScore(-80, 'b')).toBe(80)
  })

  it('从 FEN 取行棋方', () => {
    expect(fenTurn('4k4/9/9/9/9/9/9/9/9/4K4 w')).toBe('w')
    expect(fenTurn('4k4/9/9/9/9/9/9/9/9/4K4 b')).toBe('b')
    expect(fenTurn('4k4/9/9/9/9/9/9/9/9/4K4')).toBe('w') // 缺省红方
  })

  it('redScoreFromFen：黑方占优时应为负（红方视角）', () => {
    // 黑方行棋且引擎分 +300（行棋方黑方占优）→ 红方视角应为 -300
    expect(redScoreFromFen(300, '4k4/9/9/9/9/9/9/9/9/4K4 b')).toBe(-300)
    expect(redScoreFromFen(300, '4k4/9/9/9/9/9/9/9/9/4K4 w')).toBe(300)
  })
})
