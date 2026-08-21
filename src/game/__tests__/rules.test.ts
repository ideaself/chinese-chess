/**
 * 规则引擎回归测试
 */
import { describe, it, expect } from 'vitest'
import { boardFromFen } from '../board'
import { getLegalMoves, getAllLegalMoves, getGameStatus } from '../rules'

const has = (moves: { col: number; row: number }[], c: number, r: number) =>
  moves.some(m => m.col === c && m.row === r)

describe('合法走法过滤', () => {
  it('将军着法应合法（车沉底将军）', () => {
    const st = boardFromFen('4k4/9/9/9/4P4/9/9/9/9/R3K4 w')
    expect(has(getLegalMoves(st, 0, 0), 0, 9)).toBe(true)
  })

  it('送将着法应被禁止（黑车锁列时帅不能留列内）', () => {
    const st = boardFromFen('4k4/9/9/4r4/9/9/9/9/9/4K4 w')
    const moves = getLegalMoves(st, 4, 0)
    expect(has(moves, 3, 0)).toBe(true)
    expect(has(moves, 5, 0)).toBe(true)
    expect(has(moves, 4, 1)).toBe(false)
  })

  it('飞将禁手（双王同列无遮挡不能对脸）', () => {
    const st = boardFromFen('3k5/9/9/9/9/9/9/9/9/3K5 w')
    const moves = getLegalMoves(st, 3, 0)
    expect(has(moves, 3, 1)).toBe(false)
    expect(has(moves, 4, 0)).toBe(true)
  })
})

describe('终局判定', () => {
  it('底线车将 = 将死', () => {
    const st = boardFromFen('R3k4/9/9/9/9/9/9/9/9/4K4 b')
    const status = getGameStatus(st)
    expect(status.isGameOver).toBe(true)
    expect(status.result).toBe('1-0')
    expect(status.reason).toBe('将死')
  })

  it('一步成杀全链路（兵锁肋线+车贴脸）', () => {
    // 前置局面红先行，e7e8 绝杀
    const before = '4k4/3P1P3/4R4/9/9/9/9/9/9/4K4 w'
    const stB = boardFromFen(before)
    expect(getGameStatus(stB).isGameOver).toBe(false)

    // 车进到 (4,8) 后黑方无解
    const after = '4k4/3P1PR2/9/9/9/9/9/9/9/4K4 b'
    const status = getGameStatus(boardFromFen(after))
    expect(status.isGameOver).toBe(true)
    expect(status.result).toBe('1-0')
  })

  it('轮到行棋方时不误判终局', () => {
    const st = boardFromFen('3ak3/2C1k4/9/9/9/9/9/9/9/4K4 w')
    expect(getGameStatus(st).isGameOver).toBe(false)
  })
})

describe('初始局面', () => {
  it('44 个合法着法且未结束', () => {
    const st = boardFromFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w')
    expect(getAllLegalMoves(st).length).toBe(44)
    expect(getGameStatus(st).isGameOver).toBe(false)
  })
})
