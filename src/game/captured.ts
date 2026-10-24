/**
 * 吃子展示：由「初始局面 − 当前局面」推导双方被吃掉的子。
 * 不新增状态，悔棋/复盘自动跟着局面走。
 */
import { boardFromFen, type BoardState } from './board'

const ORDER = ['R', 'N', 'C', 'A', 'B', 'P', 'K']

const GLYPHS: Record<string, string> = {
  K: '帅', k: '将', A: '仕', a: '士', B: '相', b: '象',
  N: '马', n: '马', R: '车', r: '车', C: '炮', c: '炮', P: '兵', p: '卒',
}

function countPieces(board: BoardState): Map<string, number> {
  const m = new Map<string, number>()
  for (const col of board.board) {
    for (const ch of col) {
      if (ch === '.') continue
      m.set(ch, (m.get(ch) ?? 0) + 1)
    }
  }
  return m
}

/**
 * 返回双方「被吃掉」的棋子字符（红方大写 / 黑方小写），按子力从大到小排序。
 * captured.w = 红方损失（即黑方战果），captured.b = 黑方损失。
 */
export function capturedPieces(startFen: string, board: BoardState): { w: string[]; b: string[] } {
  let start: BoardState
  try {
    start = boardFromFen(startFen)
  } catch {
    return { w: [], b: [] }
  }
  const before = countPieces(start)
  const now = countPieces(board)
  const out: { w: string[]; b: string[] } = { w: [], b: [] }
  for (const upper of ORDER) {
    for (const ch of [upper, upper.toLowerCase()]) {
      const diff = (before.get(ch) ?? 0) - (now.get(ch) ?? 0)
      if (diff <= 0) continue
      const arr = ch === upper ? out.w : out.b
      for (let i = 0; i < diff; i++) arr.push(ch)
    }
  }
  return out
}

/** 子力字符 → 中文棋子名 */
export function pieceGlyph(ch: string): string {
  return GLYPHS[ch] ?? '?'
}

/** 子力分（仅用于展示排序/统计，车9 马4 炮4.5 相仕2 兵1） */
export function pieceValue(ch: string): number {
  switch (ch.toUpperCase()) {
    case 'R': return 9
    case 'C': return 4.5
    case 'N': return 4
    case 'A': return 2
    case 'B': return 2
    case 'P': return 1
    default: return 0
  }
}
