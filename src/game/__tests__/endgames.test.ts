/**
 * 残局训练预设合法性测试
 */
import { describe, it, expect } from 'vitest'
import { ENDGAME_PRESETS } from '../endgames'
import { boardFromFen, makeMove, COLS, ROWS } from '../board'
import { getAllLegalMoves, isSideInCheck, chineseFromFen } from '../rules'

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

  // 回归：曾出现「铁门栓」文案写"配合车兵"但局面无车、「大胆穿心」文案写"弃车"但只有一车
  it('名称/描述提到的棋子确实存在于局面中', () => {
    const MATERIAL: Array<[string, string]> = [
      ['车', 'Rr'], ['马', 'Nn'], ['炮', 'Cc'], ['兵', 'P'], ['卒', 'p'],
      ['士', 'Aa'], ['仕', 'Aa'], ['相', 'B'], ['象', 'Bb'], ['帅', 'K'], ['将', 'k'],
    ]
    for (const p of ENDGAME_PRESETS) {
      const pieces = p.fen.split(' ')[0].replace(/[^a-zA-Z]/g, '')
      const text = p.name + p.desc
      for (const [word, letters] of MATERIAL) {
        if (!text.includes(word)) continue
        expect(
          pieces.split('').some(ch => letters.includes(ch)),
          `${p.id} 文案提到「${word}」，但局面（${p.fen}）里没有`,
        ).toBe(true)
      }
    }
  })

  // 回归：rook-king 的 FEN 曾少一段（棋子整体上移一行）
  it('FEN 均为完整 10 段', () => {
    for (const p of ENDGAME_PRESETS) {
      expect(p.fen.split(' ')[0].split('/'), p.id).toHaveLength(10)
    }
  })

  it('初始局面合法：红方不被将军且有合法着法', () => {
    for (const p of ENDGAME_PRESETS) {
      const st = boardFromFen(p.fen)
      expect(isSideInCheck(st, true), `${p.id} 红方初始被将军`).toBe(false)
      expect(getAllLegalMoves(st).length, `${p.id} 红方无合法着法`).toBeGreaterThan(0)
    }
  })

  /** 列出一步将死（含困毙）的着法 */
  function mateInOneMoves(fen: string): string[] {
    const st = boardFromFen(fen)
    const out: string[] = []
    for (const m of getAllLegalMoves(st)) {
      const next = makeMove(st, { ...m, turn: st.turn })
      if (getAllLegalMoves(next).length === 0) {
        out.push(`${String.fromCharCode(97 + m.from.col)}${m.from.row}${String.fromCharCode(97 + m.to.col)}${m.to.row}`)
      }
    }
    return out
  }

  // 回归：闷宫杀/铁门栓原局面无法取胜（红方子力不足），已换成一步杀的真杀型
  it('杀型类预设确有一步杀（且答案唯一）', () => {
    for (const id of ['smothered-palace', 'iron-bolt']) {
      const p = ENDGAME_PRESETS.find(x => x.id === id)!
      const mates = mateInOneMoves(p.fen)
      expect(mates, `${p.name} 没有一步杀`).toHaveLength(1)
      // 杀法记谱非空，便于文案展示
      expect(chineseFromFen(p.fen, mates[0]).length).toBeGreaterThan(0)
    }
  })

  it('黑方在初始局面不是无着可走（避免"对手已困毙"的退化局面）', () => {
    for (const p of ENDGAME_PRESETS) {
      const blackToMove = boardFromFen(p.fen.replace(' w', ' b'))
      expect(getAllLegalMoves(blackToMove).length, `${p.id} 黑方初始即无着（局面退化）`).toBeGreaterThan(0)
    }
  })
})
