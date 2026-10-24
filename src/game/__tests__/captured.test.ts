import { describe, it, expect } from 'vitest'
import { boardFromFen, START_FEN } from '../board'
import { capturedPieces, pieceGlyph, pieceValue } from '../captured'

describe('吃子展示', () => {
  it('初始局面没有吃子', () => {
    const b = boardFromFen(START_FEN)
    expect(capturedPieces(START_FEN, b)).toEqual({ w: [], b: [] })
  })

  it('黑方少一个卒 → 记入红方战果', () => {
    const b = boardFromFen(START_FEN)
    // col0,row6 是黑方最左的卒（row 6 = 黑方兵线）
    const col = b.board.map(c => c.slice())
    col[0][6] = '.'
    const res = capturedPieces(START_FEN, { ...b, board: col })
    expect(res.b).toEqual(['p'])
    expect(res.w).toEqual([])
  })

  it('红方少一车 → 记入黑方战果，并按子力排序', () => {
    const b = boardFromFen(START_FEN)
    const col = b.board.map(c => c.slice())
    col[0][0] = '.' // 红车
    col[1][0] = '.' // 红马
    const res = capturedPieces(START_FEN, { ...b, board: col })
    expect(res.w[0]).toBe('R')
    expect(res.w).toContain('N')
  })

  it('棋子名与子力值', () => {
    expect(pieceGlyph('R')).toBe('车')
    expect(pieceGlyph('p')).toBe('卒')
    expect(pieceValue('R')).toBe(9)
    expect(pieceValue('n')).toBe(4)
    expect(pieceValue('k')).toBe(0)
  })

  it('坏 FEN 不抛异常', () => {
    const b = boardFromFen(START_FEN)
    expect(capturedPieces('not-a-fen', b)).toEqual({ w: [], b: [] })
  })
})
