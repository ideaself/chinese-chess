/**
 * 残局训练预设合法性测试
 */
import { describe, it, expect } from 'vitest'
import { ENDGAME_PRESETS } from '../endgames'
import { boardFromFen, COLS, ROWS } from '../board'

function findKings(fen: string): { red: { col: number; row: number } | null; black: { col: number; row: number } | null } {
  const st = boardFromFen(fen)
  let red = null, black = null
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (st.board[c][r] === 'K') red = { col: c, row: r }
      if (st.board[c][r] === 'k') black = { col: c, row: r }
    }
  }
  return { red, black }
}

describe('ENDGAME_PRESETS', () => {
  it('每个预设恰好一红一黑两个王，均在九宫内且不对面', () => {
    expect(ENDGAME_PRESETS.length).toBeGreaterThanOrEqual(10)
    for (const p of ENDGAME_PRESETS) {
      const { red, black } = findKings(p.fen)
      expect(red, `${p.id} 缺红帅`).toBeTruthy()
      expect(black, `${p.id} 缺黑将`).toBeTruthy()
      // 红帅在底三行 3-5 列
      expect(red!.col).toBeGreaterThanOrEqual(3)
      expect(red!.col).toBeLessThanOrEqual(5)
      expect(red!.row).toBeLessThanOrEqual(2)
      // 黑将在顶三行 3-5 列
      expect(black!.col).toBeGreaterThanOrEqual(3)
      expect(black!.col).toBeLessThanOrEqual(5)
      expect(black!.row).toBeGreaterThanOrEqual(7)
      // 不"飞将"（同列无隔子相对）
      if (red!.col === black!.col) {
        const st = boardFromFen(p.fen)
        let screens = 0
        for (let r = red!.row + 1; r < black!.row; r++) {
          if (st.board[red!.col][r] !== '.') screens++
        }
        expect(screens, `${p.id} 帅将直接对面`).toBeGreaterThan(0)
      }
    }
  })
})
