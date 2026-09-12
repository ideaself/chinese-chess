/**
 * AI 收官纠偏回归测试
 */
import { describe, it, expect } from 'vitest'
import { boardFromFen } from '../board'
import { createEmptyGame } from '../model'
import type { Ply } from '../model'
import {
  moveGivesCheck,
  shouldCorrectRepeatedCheck,
  pickNonCheckingCandidate,
} from '../aiEndgame'

/** 构造只关心 走棋方/是否将军 的假 Ply 序列 */
function fakePlies(spec: Array<{ turn: 'w' | 'b'; check: boolean }>): Ply[] {
  return spec.map(s => ({ turn: s.turn, inCheck: s.check } as Ply))
}

describe('moveGivesCheck', () => {
  const board = boardFromFen('4k4/9/9/9/4P4/9/9/9/9/R3K4 w')

  it('车沉底将军', () => {
    expect(moveGivesCheck(board, 'a0a9')).toBe(true)
  })

  it('非将军着法', () => {
    expect(moveGivesCheck(board, 'a0a1')).toBe(false)
  })

  it('非法/异常输入不抛错', () => {
    expect(moveGivesCheck(board, '')).toBe(false)
    expect(moveGivesCheck(board, 'z9z9')).toBe(false)
    expect(moveGivesCheck(board, 'e5e5')).toBe(false)
  })
})

describe('shouldCorrectRepeatedCheck', () => {
  const board = boardFromFen('4k4/9/9/9/4P4/9/9/9/9/R3K4 w')

  function gameWithAiPlies(checks: Array<{ check: boolean; turn?: 'w' | 'b' }>) {
    const game = createEmptyGame()
    game.plies = fakePlies(checks.map(c => ({ turn: c.turn ?? 'w', check: c.check })))
    return game
  }

  it('大优 + 反复将军 + 引擎着法为将军 → 触发', () => {
    const game = gameWithAiPlies([{ check: true }, { check: true }, { check: false }, { check: true }])
    expect(shouldCorrectRepeatedCheck(game, board, 'a0a9', 565)).toBe(true)
  })

  it('优势不足不触发（可能是在争取和棋）', () => {
    const game = gameWithAiPlies([{ check: true }, { check: true }, { check: true }])
    expect(shouldCorrectRepeatedCheck(game, board, 'a0a9', 300)).toBe(false)
  })

  it('杀棋分不触发（将军可能就是杀着）', () => {
    const game = gameWithAiPlies([{ check: true }, { check: true }, { check: true }])
    expect(shouldCorrectRepeatedCheck(game, board, 'a0a9', 100000 - 5)).toBe(false)
  })

  it('评估未知（如弱级拟人走法）不触发', () => {
    const game = gameWithAiPlies([{ check: true }, { check: true }])
    expect(shouldCorrectRepeatedCheck(game, board, 'a0a9', null)).toBe(false)
  })

  it('引擎着法非将军不触发', () => {
    const game = gameWithAiPlies([{ check: true }, { check: true }, { check: true }])
    expect(shouldCorrectRepeatedCheck(game, board, 'a0a1', 565)).toBe(false)
  })

  it('AI 被将军时不干预（优先应将）', () => {
    const inCheckBoard = boardFromFen('4k4/9/9/9/9/9/9/9/4r4/4K4 w')
    const game = gameWithAiPlies([{ check: true }, { check: true }, { check: true }])
    expect(shouldCorrectRepeatedCheck(game, inCheckBoard, 'a0a9', 565)).toBe(false)
  })

  it('仅孤立一手将军不触发', () => {
    const game = gameWithAiPlies([{ check: true }, { check: false }, { check: false }, { check: false }])
    expect(shouldCorrectRepeatedCheck(game, board, 'a0a9', 565)).toBe(false)
  })

  it('将军统计只算 AI 自己的着法', () => {
    const game = gameWithAiPlies([
      { turn: 'b', check: true },
      { turn: 'b', check: true },
      { turn: 'b', check: true },
    ])
    expect(shouldCorrectRepeatedCheck(game, board, 'a0a9', 565)).toBe(false)
  })
})

describe('pickNonCheckingCandidate', () => {
  const board = boardFromFen('4k4/9/9/9/4P4/9/9/9/9/R3K4 w')

  it('选分数接近的非将军着', () => {
    const lines = [
      { move: 'a0a9', score: 560 },
      { move: 'a0a1', score: 555 },
      { move: 'e0e1', score: 500 },
    ]
    expect(pickNonCheckingCandidate(lines, board, 565)?.move).toBe('a0a1')
  })

  it('非将军着分数落差过大时不换（宁可继续将军）', () => {
    const lines = [
      { move: 'a0a9', score: 560 },
      { move: 'a0a1', score: 400 },
    ]
    expect(pickNonCheckingCandidate(lines, board, 565)).toBe(null)
  })

  it('无最佳分参考时取第一个非将军着', () => {
    const lines = [
      { move: 'a0a9', score: 560 },
      { move: 'a0a1', score: 100 },
    ]
    expect(pickNonCheckingCandidate(lines, board, null)?.move).toBe('a0a1')
  })

  it('全是将军着返回 null', () => {
    const lines = [{ move: 'a0a9', score: 560 }]
    expect(pickNonCheckingCandidate(lines, board, 565)).toBe(null)
  })
})
