/**
 * 关键手导航 / 评级徽标回归测试
 */
import { describe, it, expect } from 'vitest'
import { createEmptyGame } from '../model'
import type { Ply, MoveClassification } from '../model'
import { findNextKeyPly, findPrevKeyPly } from '../keyNav'
import { moveTag } from '../moveTags'

function gameWithClasses(classes: (MoveClassification | undefined)[]) {
  const game = createEmptyGame()
  game.plies = classes.map((c, i) => ({
    plyIndex: i + 1,
    turn: i % 2 === 0 ? 'w' : 'b',
    move: 'a0a1',
    moveCn: '车',
    fenBefore: game.startFen,
    fenAfter: game.startFen,
    inCheck: false,
    isCapture: false,
    analysis: c
      ? { classification: c, score: 0, depth: 0, bestMove: '', pv: [], moveLoss: 0, analyzedAt: 0 }
      : undefined,
  } as Ply))
  return game
}

describe('findNextKeyPly / findPrevKeyPly', () => {
  const game = gameWithClasses(['good', 'mistake', 'good', 'blunder2', 'good'])

  it('从当前局面向后找第一处失误', () => {
    expect(findNextKeyPly(game, 0)).toBe(2)
    expect(findNextKeyPly(game, 2)).toBe(4)
    expect(findNextKeyPly(game, 4)).toBe(null)
  })

  it('当前正处于关键手之后时找下一处', () => {
    expect(findNextKeyPly(game, 1)).toBe(2)
    expect(findNextKeyPly(game, 3)).toBe(4)
  })

  it('向前跳过当前紧邻的一手', () => {
    expect(findPrevKeyPly(game, 4)).toBe(2)
    expect(findPrevKeyPly(game, 2)).toBe(null)
    expect(findPrevKeyPly(game, 5)).toBe(4)
  })

  it('未分析的棋谱返回 null', () => {
    const raw = gameWithClasses([undefined, undefined, undefined])
    expect(findNextKeyPly(raw, 0)).toBe(null)
    expect(findPrevKeyPly(raw, 3)).toBe(null)
  })
})

describe('moveTag', () => {
  it('映射评级文案与样式类', () => {
    expect(moveTag('blunder')).toEqual({ t: '劣', c: 'mt-blunder' })
    expect(moveTag('blunder2')).toEqual({ t: '漏', c: 'mt-blunder2' })
  })
  it('未知/空分类返回 null', () => {
    expect(moveTag(undefined)).toBe(null)
    expect(moveTag('unknown')).toBe(null)
  })
})
