/**
 * 中国象棋棋盘核心逻辑
 * 
 * 坐标系统:
 *   - col: 0-8 (a-i, 从左到右，红方视角)
 *   - row: 0-9 (从下到上，红方在底部 row 0-4，黑方在顶部 row 5-9)
 * 
 * 棋子编码 (FEN):
 *   R=红车 N=红马 B=红相 A=红仕 K=红帅 C=红炮 P=红兵
 *   r=黑车 n=黑马 b=黑象 a=黑士 k=黑将 c=黑炮 p=黑卒
 */

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w'

export type PieceChar = string
export type Turn = 'w' | 'b'

export interface Pos {
  col: number
  row: number
}

export interface Move {
  from: Pos
  to: Pos
  /** 被吃掉的棋子 ('.' 表示无) */
  captured?: PieceChar
  /** 走棋方 */
  turn: Turn
}

export interface BoardState {
  /** board[col][row] = 棋子字符 或 '.' */
  board: PieceChar[][]
  turn: Turn
  /** 半回合数 (不计步) */
  halfmove: number
  /** 回合数 */
  fullmove: number
}

// ── 常量 ──────────────────────────────────────────────────────────

export const COLS = 9
export const ROWS = 10

/** 红方棋子字符 (大写) */
const RED_PIECES = 'KABNRCP'
/** 黑方棋子字符 (小写) */
const BLACK_PIECES = 'kabnrcp'

// ── 棋盘创建 ──────────────────────────────────────────────────────

/** 创建空棋盘 */
export function createEmptyBoard(): PieceChar[][] {
  return Array.from({ length: COLS }, () => Array(ROWS).fill('.'))
}

/** 从 FEN 创建棋盘 */
export function boardFromFen(fen: string): BoardState {
  const parts = fen.split(' ')
  const board = createEmptyBoard()
  const rows = parts[0].split('/')

  // FEN 行序: 第 0 行 = 顶部 (row 9)，第 9 行 = 底部 (row 0)
  // 即 Black-first 标准: rnbakabnr 在 row 9 (顶部), RNBAKABNR 在 row 0 (底部)
  rows.forEach((rowStr, rowIdx) => {
    let col = 0
    for (const ch of rowStr) {
      if (ch >= '0' && ch <= '9') {
        col += parseInt(ch)
      } else {
        const boardRow = ROWS - 1 - rowIdx
        if (col < COLS && boardRow >= 0 && boardRow < ROWS) {
          board[col][boardRow] = ch
        }
        col++
      }
    }
  })

  return {
    board,
    turn: (parts[1] || 'w') as Turn,
    halfmove: parts.length > 4 ? parseInt(parts[4]) : 0,
    fullmove: parts.length > 5 ? parseInt(parts[5]) : 1,
  }
}

/** 棋盘转 FEN (标准 Black-first 格式) */
export function boardToFen(state: BoardState): string {
  const rows: string[] = []
  for (let r = ROWS - 1; r >= 0; r--) {
    let rowStr = ''
    let empty = 0
    for (let c = 0; c < COLS; c++) {
      const piece = state.board[c][r]
      if (piece === '.') {
        empty++
      } else {
        if (empty > 0) {
          rowStr += empty
          empty = 0
        }
        rowStr += piece
      }
    }
    if (empty > 0) rowStr += empty
    rows.push(rowStr)
  }
  return `${rows.join('/')} ${state.turn} - - ${state.halfmove} ${state.fullmove}`
}

// ── 棋子判断 ──────────────────────────────────────────────────────

export function isRed(piece: PieceChar): boolean {
  return piece !== '.' && piece === piece.toUpperCase() && RED_PIECES.includes(piece.toUpperCase())
}

export function isBlack(piece: PieceChar): boolean {
  return piece !== '.' && piece === piece.toLowerCase() && BLACK_PIECES.includes(piece.toLowerCase())
}

export function isInBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS
}

// ── 棋子走法生成 ──────────────────────────────────────────────────

interface MoveGenResult {
  moves: Pos[]
  /** 每个目标位置: 'go' 空格 | 'eat' 吃子 */
  flags: Record<string, 'go' | 'eat'>
}

function key(col: number, row: number): string {
  return `${col},${row}`
}

/** 生成某位置棋子的所有合法目标位置 */
export function generateMoves(state: BoardState, col: number, row: number): MoveGenResult {
  const result: MoveGenResult = { moves: [], flags: {} }
  const piece = state.board[col][row]
  if (piece === '.') return result

  const red = isRed(piece)
  const type = piece.toLowerCase()

  const tryMove = (tc: number, tr: number, eat = false) => {
    if (!isInBounds(tc, tr)) return false
    const target = state.board[tc][tr]
    if (target === '.') {
      result.moves.push({ col: tc, row: tr })
      result.flags[key(tc, tr)] = 'go'
      return true
    } else {
      const targetRed = isRed(target)
      if ((red && !targetRed) || (!red && targetRed)) {
        result.moves.push({ col: tc, row: tr })
        result.flags[key(tc, tr)] = 'eat'
      }
      return false
    }
  }

  const inPalace = (c: number, r: number): boolean => {
    // 九宫：红方 col 3-5, row 0-2；黑方 col 3-5, row 7-9
    if (c < 3 || c > 5) return false
    if (red) return r >= 0 && r <= 2
    return r >= 7 && r <= 9
  }

  const inOwnHalf = (c: number, r: number): boolean => {
    if (red) return r <= 4
    return r >= 5
  }

  const crossedRiver = (r: number): boolean => {
    return red ? r >= 5 : r <= 4
  }

  // 判断是否被塞象眼/蹩马腿
  const blocked = (bc: number, br: number): boolean => {
    return isInBounds(bc, br) && state.board[bc][br] !== '.'
  }

  switch (type) {
    case 'k': { // 将/帅
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      for (const [dc, dr] of dirs) {
        const tc = col + dc, tr = row + dr
        if (inPalace(tc, tr)) tryMove(tc, tr)
      }
      // 飞将（对脸）—— 简化：跳过完整实现
      break
    }
    case 'a': { // 仕/士
      const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
      for (const [dc, dr] of dirs) {
        const tc = col + dc, tr = row + dr
        if (inPalace(tc, tr)) tryMove(tc, tr)
      }
      break
    }
    case 'b': { // 相/象
      const dirs = [[2, 2], [2, -2], [-2, 2], [-2, -2]]
      for (const [dc, dr] of dirs) {
        const tc = col + dc, tr = row + dr
        if (!isInBounds(tc, tr)) continue
        // 象眼
        const eyeCol = col + dc / 2, eyeRow = row + dr / 2
        if (blocked(eyeCol, eyeRow)) continue
        // 不能过河
        if (!inOwnHalf(tc, tr)) continue
        tryMove(tc, tr)
      }
      break
    }
    case 'n': { // 马
      const jumps = [
        [1, 2], [2, 1], [2, -1], [1, -2],
        [-1, -2], [-2, -1], [-2, 1], [-1, 2],
      ]
      for (const [dc, dr] of jumps) {
        const tc = col + dc, tr = row + dr
        if (!isInBounds(tc, tr)) continue
        // 蹩马腿：马腿位置
        const legCol = col + (Math.abs(dc) === 2 ? dc / 2 : 0)
        const legRow = row + (Math.abs(dr) === 2 ? dr / 2 : 0)
        if (blocked(legCol, legRow)) continue
        tryMove(tc, tr)
      }
      break
    }
    case 'r': { // 车
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      for (const [dc, dr] of dirs) {
        let tc = col + dc, tr = row + dr
        while (isInBounds(tc, tr)) {
          if (!tryMove(tc, tr)) break
          tc += dc
          tr += dr
        }
      }
      break
    }
    case 'c': { // 炮
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      for (const [dc, dr] of dirs) {
        let tc = col + dc, tr = row + dr
        // 先走空位（炮可以走多格）
        while (isInBounds(tc, tr) && state.board[tc][tr] === '.') {
          result.moves.push({ col: tc, row: tr })
          result.flags[key(tc, tr)] = 'go'
          tc += dc
          tr += dr
        }
        // 跳过炮架
        if (isInBounds(tc, tr)) {
          tc += dc
          tr += dr
          // 找吃子目标（炮架后第一个棋子）
          while (isInBounds(tc, tr)) {
            if (state.board[tc][tr] !== '.') {
              tryMove(tc, tr, true)
              break
            }
            tc += dc
            tr += dr
          }
        }
      }
      break
    }
    case 'p': { // 兵/卒
      const forward = red ? 1 : -1
      // 向前
      const fr = row + forward
      if (isInBounds(col, fr)) {
        tryMove(col, fr)
        // 过河后可左右
        if (crossedRiver(row)) {
          tryMove(col - 1, fr)
          tryMove(col + 1, fr)
        }
      }
      break
    }
  }

  return result
}

/** 检查一步棋是否合法 */
export function isLegalMove(state: BoardState, from: Pos, to: Pos): boolean {
  const piece = state.board[from.col][from.row]
  if (piece === '.') return false
  const red = isRed(piece)
  const turnRed = state.turn === 'w'
  if (red !== turnRed) return false

  const { moves } = generateMoves(state, from.col, from.row)
  return moves.some(m => m.col === to.col && m.row === to.row)
}

// ── 走棋 ──────────────────────────────────────────────────────────

/** 执行一步棋，返回新状态 */
export function makeMove(state: BoardState, move: Move): BoardState {
  // 深拷贝：内层数组也必须独立
  const newBoard = state.board.map(row => [...row])
  const piece = newBoard[move.from.col][move.from.row]
  const captured = newBoard[move.to.col][move.to.row]

  newBoard[move.to.col][move.to.row] = piece
  newBoard[move.from.col][move.from.row] = '.'

  return {
    board: newBoard,
    turn: state.turn === 'w' ? 'b' : 'w',
    halfmove: captured !== '.' ? 0 : state.halfmove + 1,
    fullmove: state.turn === 'b' ? state.fullmove + 1 : state.fullmove,
  }
}

/** 位置转坐标字符串 (col 0-8 → a-i, row 0-9 → 0-9) */
export function posToCoord(pos: Pos): string {
  return `${String.fromCharCode(97 + pos.col)}${pos.row}`
}

/** 坐标字符串转位置 */
export function coordToPos(coord: string): Pos {
  return {
    col: coord.charCodeAt(0) - 97,
    row: parseInt(coord[1]),
  }
}
