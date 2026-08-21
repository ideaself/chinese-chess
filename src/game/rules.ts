/**
 * 中国象棋完整规则引擎
 *
 * 在 board.ts 基础上补全:
 *   - 将军检测
 *   - 飞将规则
 *   - 将死/困毙判定
 *   - 合法走法过滤（走棋后不能被将军）
 *   - 和棋判断（长将/长捉/60回合无吃子）
 */

import type { BoardState, Move, Pos, PieceChar } from './board'
import {
  COLS, ROWS, isRed, isBlack, isInBounds, generateMoves,
  makeMove, createEmptyBoard, boardFromFen, boardToFen,
} from './board'

// ── 将军检测 ──────────────────────────────────────────────────────

/** 找到一方将/帅的位置 */
export function findKing(state: BoardState, red: boolean): Pos | null {
  const king = red ? 'K' : 'k'
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (state.board[c][r] === king) return { col: c, row: r }
    }
  }
  return null
}

/** 检查某个位置是否被对方攻击 */
function isSquareAttacked(state: BoardState, pos: Pos, byRed: boolean): boolean {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const piece = state.board[c][r]
      if (piece === '.') continue
      if (byRed !== isRed(piece)) continue

      // 生成该棋子的攻击范围（不考虑将死限制）
      const { moves } = generateRawMoves(state, c, r)
      if (moves.some(m => m.col === pos.col && m.row === pos.row)) {
        return true
      }
    }
  }
  return false
}

/** 检查指定一方（red=true 红方）的将/帅是否被将军 */
export function isSideInCheck(state: BoardState, red: boolean): boolean {
  const king = findKing(state, red)
  if (!king) return false
  return isSquareAttacked(state, king, !red)
}

/** 检查当前行棋方是否被将军 */
export function isInCheck(state: BoardState): boolean {
  return isSideInCheck(state, state.turn === 'w')
}

// ── 飞将规则 ──────────────────────────────────────────────────────

/** 检查两个将帅是否面对面（飞将） */
function areKingsFacing(state: BoardState): boolean {
  const redKing = findKing(state, true)
  const blackKing = findKing(state, false)
  if (!redKing || !blackKing) return false

  if (redKing.col !== blackKing.col) return false

  // 检查同一列上是否有其他棋子
  const minRow = Math.min(redKing.row, blackKing.row)
  const maxRow = Math.max(redKing.row, blackKing.row)
  for (let r = minRow + 1; r < maxRow; r++) {
    if (state.board[redKing.col][r] !== '.') return false
  }
  return true
}

// ── 原始走法生成（不限制被将军） ─────────────────────────────────

/** 生成某棋子所有可能的目标位置（不含将军过滤） */
function generateRawMoves(state: BoardState, col: number, row: number): { moves: Pos[] } {
  return generateMoves(state, col, row)
}

// ── 合法走法（过滤将军后） ────────────────────────────────────────

/** 获取某棋子所有合法走法（走棋后不能被将军，不能飞将） */
export function getLegalMoves(state: BoardState, col: number, row: number): Pos[] {
  const piece = state.board[col][row]
  if (piece === '.') return []

  // 走棋方（makeMove 后 turn 会翻转，必须提前记录）
  const moverRed = isRed(piece)

  const { moves: rawMoves } = generateRawMoves(state, col, row)
  const legal: Pos[] = []

  for (const target of rawMoves) {
    const move: Move = { from: { col, row }, to: target, turn: state.turn }
    const newState = makeMove(state, move)

    // 走棋后自己的将/帅不能被将军
    if (isSideInCheck(newState, moverRed)) continue

    // 走棋后不能飞将
    if (areKingsFacing(newState)) continue

    legal.push(target)
  }

  return legal
}

/** 获取当前方所有合法走法 */
export function getAllLegalMoves(state: BoardState): Array<{ from: Pos; to: Pos }> {
  const allMoves: Array<{ from: Pos; to: Pos }> = []
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const piece = state.board[c][r]
      if (piece === '.') continue
      if (isRed(piece) !== (state.turn === 'w')) continue

      const targets = getLegalMoves(state, c, r)
      for (const t of targets) {
        allMoves.push({ from: { col: c, row: r }, to: t })
      }
    }
  }
  return allMoves
}

// ── 将死/困毙判定 ────────────────────────────────────────────────

export type GameEndReason = 'checkmate' | 'stalemate' | null

/** 判断对局是否结束，返回结束原因 */
export function getGameEndReason(state: BoardState): GameEndReason {
  const hasLegalMove = getAllLegalMoves(state).length > 0
  if (hasLegalMove) return null

  // 无合法走法：将军→将死，不将军→困毙
  return isInCheck(state) ? 'checkmate' : 'stalemate'
}

/** 获取当前方结果（用于保存棋谱） */
export function getResult(state: BoardState): string {
  const end = getGameEndReason(state)
  if (end === 'checkmate') {
    // 将死，当前方输
    return state.turn === 'w' ? '0-1' : '1-0'
  }
  if (end === 'stalemate') {
    return '1/2-1/2'
  }
  return '*' // 未结束
}

// ── 长将/长捉判定（简化版） ───────────────────────────────────────

/** 检查是否出现三次重复局面（长将/长捉） */
export function isThreefoldRepetition(positions: string[]): boolean {
  const counts = new Map<string, number>()
  for (const pos of positions) {
    counts.set(pos, (counts.get(pos) || 0) + 1)
    if (counts.get(pos)! >= 3) return true
  }
  return false
}

/** 检查是否60回合无吃子（自然和棋） */
export function isSixtyMoveRule(halfmove: number): boolean {
  return halfmove >= 120 // 60 回合 = 120 半回合
}

// ── 完整合法走法（含所有和棋判定） ────────────────────────────────

export interface GameStatus {
  /** 是否结束 */
  isGameOver: boolean
  /** 结果 '1-0' | '0-1' | '1/2-1/2' | '*' */
  result: string
  /** 结束原因 */
  reason: string
  /** 当前是否被将军 */
  inCheck: boolean
  /** 当前方所有合法走法数 */
  legalMoveCount: number
}

/** 获取完整的对局状态 */
export function getGameStatus(
  state: BoardState,
  positions: string[] = [],
): GameStatus {
  const inCheck = isInCheck(state)
  const legalMoves = getAllLegalMoves(state)
  const legalMoveCount = legalMoves.length

  // 和棋判定
  if (isThreefoldRepetition(positions)) {
    return { isGameOver: true, result: '1/2-1/2', reason: '三次重复局面', inCheck, legalMoveCount }
  }
  if (isSixtyMoveRule(state.halfmove)) {
    return { isGameOver: true, result: '1/2-1/2', reason: '60回合无吃子', inCheck, legalMoveCount }
  }

  // 将死/困毙
  if (legalMoveCount === 0) {
    if (inCheck) {
      const result = state.turn === 'w' ? '0-1' : '1-0'
      return { isGameOver: true, result, reason: '将死', inCheck, legalMoveCount }
    } else {
      return { isGameOver: true, result: '1/2-1/2', reason: '困毙（无子可动）', inCheck, legalMoveCount }
    }
  }

  return { isGameOver: false, result: '*', reason: '', inCheck, legalMoveCount }
}

// ── 棋子中文名称映射 ──────────────────────────────────────────────

const PIECE_NAMES: Record<string, { red: string; black: string }> = {
  K: { red: '帅', black: '将' },
  A: { red: '仕', black: '士' },
  B: { red: '相', black: '象' },
  N: { red: '马', black: '马' },
  R: { red: '车', black: '车' },
  C: { red: '炮', black: '炮' },
  P: { red: '兵', black: '卒' },
}

/** 棋子转中文名 */
export function pieceToChinese(piece: PieceChar, turn: 'w' | 'b'): string {
  const type = piece.toUpperCase()
  const info = PIECE_NAMES[type]
  if (!info) return piece
  return turn === 'w' ? info.red : info.black
}

// ── 坐标转中文棋谱 ────────────────────────────────────────────────

const COL_NAMES_RED = ['九', '八', '七', '六', '五', '四', '三', '二', '一']
/** 黑方用半角阿拉伯数字（标准 PGN 输出格式） */
const COL_NAMES_BLACK = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** 数字转中文（1-10） */
function numToChinese(n: number): string {
  const map = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return map[n] || String(n)
}

/**
 * 将一步棋转换为中文棋谱格式（标准记谱法）
 * 例如：炮二平五、马8进7、车二进五
 *
 * 规则:
 *   - 平移（横线）: 棋子名 + 起始列 + 平 + 目标列
 *   - 直线进/退（帅车炮兵同列移动）: 步数为数字
 *   - 斜走棋子（马/相/仕）进/退: 数字为目标列
 *   - 进/退方向: 红方 row 增大为进，黑方 row 减小为进
 */
export function moveToChinese(state: BoardState, move: Move): string {
  const piece = state.board[move.from.col][move.from.row]
  const isRedTurn = state.turn === 'w'
  const type = piece.toUpperCase()

  // 列名：红方用中文数字（一从红方右侧开始），黑方用阿拉伯数字（1从黑方右侧开始）
  const fromColName = isRedTurn
    ? COL_NAMES_RED[move.from.col]
    : COL_NAMES_BLACK[move.from.col]
  const toColName = isRedTurn
    ? COL_NAMES_RED[move.to.col]
    : COL_NAMES_BLACK[move.to.col]

  const rowDiff = move.to.row - move.from.row
  const colDiff = move.to.col - move.from.col

  const name = pieceToChinese(piece, state.turn)

  // 进: 红方向前 = row 增大；黑方向前 = row 减小
  const forward = isRedTurn ? rowDiff > 0 : rowDiff < 0
  const action = forward ? '进' : '退'

  if (colDiff === 0) {
    // 直线纵向移动（帅/车/炮/兵）: 用步数（红方中文数字，黑方阿拉伯数字）
    const steps = Math.abs(rowDiff)
    return `${name}${fromColName}${action}${isRedTurn ? numToChinese(steps) : String(steps)}`
  }

  if (type === 'N' || type === 'B' || type === 'A') {
    // 斜走棋子（马/相/仕）: 用目标列号
    return `${name}${fromColName}${action}${toColName}`
  }

  // 横线移动（平）
  return `${name}${fromColName}平${toColName}`
}

/**
 * 从 FEN 局面把一步 UCI 走法转为中文记谱
 * 用于 AI 推荐着法的中文显示（如 bestMoveCn）
 */
export function chineseFromFen(fen: string, uci: string): string {
  try {
    const state = boardFromFen(fen)
    const from = { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) }
    const to = { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) }
    if (!isInBounds(from.col, from.row) || !isInBounds(to.col, to.row)) return uci
    if (state.board[from.col][from.row] === '.') return uci
    return moveToChinese(state, { from, to, turn: state.turn })
  } catch {
    return uci
  }
}

/**
 * 把 PV 变化序列转为中文记谱（计划第15节"主要变化"）
 * 逐半回合推进局面，非法/无法解析的走法即截断
 */
export function pvToChinese(fen: string, pv: string[], maxMoves: number = 8): string[] {
  const result: string[] = []
  try {
    let state = boardFromFen(fen)
    for (const uci of pv.slice(0, maxMoves)) {
      if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) break
      const from = { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) }
      const to = { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) }
      if (!isInBounds(from.col, from.row) || !isInBounds(to.col, to.row)) break
      if (state.board[from.col][from.row] === '.') break
      result.push(moveToChinese(state, { from, to, turn: state.turn }))
      state = makeMove(state, { from, to, turn: state.turn })
    }
  } catch {
    // 截断即可
  }
  return result
}
