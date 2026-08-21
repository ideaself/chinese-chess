/**
 * PGN 解析与导出模块
 *
 * 支持:
 *   - 标准中国象棋 PGN (Header + 中文棋谱)
 *   - UCI 格式棋谱
 *   - 最后一步只有一方走子
 *   - 导入验证 + 错误提示
 */

import type { Game, GameHeader, Ply } from './model'
import { createEmptyGame, addPlyToGame } from './model'
import { boardFromFen, boardToFen, makeMove, START_FEN, ROWS } from './board'
import { getLegalMoves, moveToChinese } from './rules'

// ── PGN 导入 ──────────────────────────────────────────────────────

export interface PGNParseResult {
  success: boolean
  game?: Game
  error?: string
  errorPly?: number
}

/**
 * 把包含多局棋谱的文本拆分为单局文本数组
 *
 * 规则: 新对局以 '[' 头的标签行开始，且之前已出现过着法文本。
 * 兼容单局（无分割）、空行分隔、连续多局等常见格式。
 */
export function splitPGNGames(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const games: string[] = []
  let current: string[] = []
  let sawMoves = false

  for (const line of lines) {
    const isHeaderLine = /^\s*\[/.test(line)
    if (isHeaderLine && sawMoves) {
      // 着法之后又出现标签行 → 上一局结束
      games.push(current.join('\n'))
      current = []
      sawMoves = false
    }
    current.push(line)
    if (!isHeaderLine && line.trim().length > 0) sawMoves = true
  }
  if (current.some(l => l.trim().length > 0)) games.push(current.join('\n'))

  return games.filter(g => g.trim().length > 0)
}

export function parsePGN(pgnText: string): PGNParseResult {
  const lines = pgnText.trim().split('\n')
  const header: GameHeader = {}
  let moveLineStart = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') { moveLineStart = i + 1; continue }
    const m = line.match(/^\[(\w+)\s+"(.*)"\]$/)
    if (m) { header[m[1]] = m[2] }
    else if (line.startsWith('[')) { continue }
    else { moveLineStart = i; break }
  }

  const startFen = header.FEN || START_FEN
  let result = header.Result || '*'
  const moveText = lines.slice(moveLineStart).join(' ').trim()

  const resultMatch = moveText.match(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/)
  if (resultMatch) result = resultMatch[1]

  let cleanMoves = moveText
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\d+\.\.\./g, '')
    .replace(/\d+\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '')
    .trim()

  const game = createEmptyGame()
  game.header = { ...game.header, ...header }
  game.startFen = startFen
  game.result = result
  game.header.Result = result

  let currentFen = startFen
  const tokens = cleanMoves.split(/\s+/).filter(t => t.length > 0)

  for (const token of tokens) {
    if (token === '' || /^\d+\.?$/.test(token) || ['1-0', '0-1', '1/2-1/2', '*'].includes(token)) continue

    // UCI 格式
    if (/^[a-i][0-9][a-i][0-9]$/.test(token)) {
      const state = boardFromFen(currentFen)
      const from = { col: token.charCodeAt(0) - 97, row: parseInt(token[1]) }
      const to = { col: token.charCodeAt(2) - 97, row: parseInt(token[3]) }
      const legal = getLegalMoves(state, from.col, from.row)
      if (!legal.some(m => m.col === to.col && m.row === to.row)) {
        return { success: false, error: `第 ${game.plies.length + 1} 步 "${token}" 不合法`, errorPly: game.plies.length + 1 }
      }
      const { game: ng } = addPlyToGame(game, token, currentFen)
      game.plies = ng.plies; game.result = ng.result
      currentFen = ng.plies[ng.plies.length - 1].fenAfter
      continue
    }

    // 中文棋谱
    const cnMove = parseChineseMove(token, currentFen)
    if (cnMove) {
      const state = boardFromFen(currentFen)
      const legal = getLegalMoves(state, cnMove.from.col, cnMove.from.row)
      if (!legal.some(m => m.col === cnMove.to.col && m.row === cnMove.to.row)) {
        return { success: false, error: `第 ${game.plies.length + 1} 步 "${token}" 在当前局面下不合法`, errorPly: game.plies.length + 1 }
      }
      const uci = `${String.fromCharCode(97 + cnMove.from.col)}${cnMove.from.row}${String.fromCharCode(97 + cnMove.to.col)}${cnMove.to.row}`
      const { game: ng } = addPlyToGame(game, uci, currentFen)
      game.plies = ng.plies; game.result = ng.result
      currentFen = ng.plies[ng.plies.length - 1].fenAfter
      continue
    }

    return { success: false, error: `第 ${game.plies.length + 1} 步无法解析: "${token}"`, errorPly: game.plies.length + 1 }
  }

  // 恢复 PGN 声明的结果（逐步重建时 addPlyToGame 会用局面状态覆盖，需还原）
  game.result = result
  game.header.Result = result

  return { success: true, game }
}

// ── 中文棋谱解析（完整实现） ──────────────────────────────────────

/** 红方列号映射: 中文数字 → 0-8 (从左到右) */
const RED_COL: Record<string, number> = {
  '九': 0, '八': 1, '七': 2, '六': 3, '五': 4, '四': 5, '三': 6, '二': 7, '一': 8,
}

/** 黑方列号映射: 阿拉伯数字 → 0-8 (从左到右) */
const BLACK_COL: Record<string, number> = {
  '１': 0, '２': 1, '３': 2, '４': 3, '５': 4, '６': 5, '７': 6, '８': 7, '９': 8,
  '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8,
}

/** 步数映射: 中文数字/阿拉伯数字 → 步数 */
const STEPS: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
}

/** 棋子类型映射 */
const PIECE_TYPE: Record<string, string> = {
  '帅': 'k', '将': 'k', '仕': 'a', '士': 'a', '相': 'b', '象': 'b',
  '马': 'n', '车': 'r', '炮': 'c', '兵': 'p', '卒': 'p',
}

/**
 * 解析中文棋谱
 *
 * 格式: [棋子][列号][进/退/平][目标列号或步数]
 * 特殊: 同列有多个同色棋子时用 前/后/中 前缀并省略列号，如 前马进6、后炮平5
 */
function parseChineseMove(token: string, fen: string): { from: { col: number; row: number }; to: { col: number; row: number } } | null {
  const state = boardFromFen(fen)
  const isRedTurn = state.turn === 'w'

  // 匹配: [前/后/中]?[棋子][列号?][进/退/平][目标]（前/后/中 前缀可省略列号）
  const match = token.match(/^(前|后|中)?(帅|将|仕|士|相|象|马|车|炮|兵|卒)([一二三四五六七八九１２３４５６７８９1-9])?(进|退|平)([一二三四五六七八九１２３４５６７８９1-9]+)$/)
  if (!match) return null

  const [, prefix, pieceStr, colStr, dir, targetStr] = match
  const pieceType = PIECE_TYPE[pieceStr]
  if (!pieceType) return null

  const pieceChar = isRedTurn ? pieceType.toUpperCase() : pieceType.toLowerCase()

  /** 收集某列上该颜色该种棋子的行号 */
  const collectRows = (col: number): number[] => {
    const rows: number[] = []
    for (let r = 0; r < ROWS; r++) {
      const p = state.board[col][r]
      if (p === pieceChar) rows.push(r)
    }
    return rows
  }

  let fromCol: number
  let candidates: number[]

  if (colStr) {
    // 标准格式: 列号定位
    fromCol = isRedTurn ? (RED_COL[colStr] ?? -1) : (BLACK_COL[colStr] ?? -1)
    if (fromCol < 0) return null
    candidates = collectRows(fromCol)
  } else if (prefix) {
    // 前后缀省略列号: 找到有 ≥2 个同类棋子的那一列
    let found: { col: number; rows: number[] } | null = null
    for (let c = 0; c < 9; c++) {
      const rows = collectRows(c)
      if (rows.length >= 2) {
        if (found) return null // 多列都有同名棋子，无法消歧
        found = { col: c, rows }
      }
    }
    if (!found) return null
    fromCol = found.col
    candidates = found.rows
  } else {
    return null
  }

  if (candidates.length === 0) return null

  // 按前后顺序排列: 红方 row 大在前，黑方 row 小在前
  const ordered = [...candidates].sort((a, b) => (isRedTurn ? b - a : a - b))

  let fromRow: number
  if (prefix === '前') {
    fromRow = ordered[0]
  } else if (prefix === '后') {
    fromRow = ordered[ordered.length - 1]
  } else if (prefix === '中' && ordered.length >= 3) {
    fromRow = ordered[1]
  } else if (candidates.length === 1) {
    fromRow = candidates[0]
  } else {
    // 同列多个但无前缀，取最前的
    fromRow = ordered[0]
  }

  // 目标位置
  let toCol: number, toRow: number

  if (dir === '平') {
    // 横移: 目标是列号
    toCol = isRedTurn ? (RED_COL[targetStr] ?? -1) : (BLACK_COL[targetStr] ?? -1)
    if (toCol < 0) return null
    toRow = fromRow
  } else {
    const forward = dir === '进'

    if (pieceType === 'n' || pieceType === 'a' || pieceType === 'b') {
      // 马/相/仕斜走: 数字为目标列号
      toCol = isRedTurn ? (RED_COL[targetStr] ?? -1) : (BLACK_COL[targetStr] ?? -1)
      if (toCol < 0) return null
      // 行差由棋子走法形状唯一确定:
      //   仕恒为1、相恒为2；马为 L 形（列差1→行差2，列差2→行差1）
      const dCol = Math.abs(toCol - fromCol)
      const dRow = pieceType === 'n' ? (dCol === 1 ? 2 : 1) : pieceType === 'b' ? 2 : 1
      toRow = isRedTurn
        ? (forward ? fromRow + dRow : fromRow - dRow)
        : (forward ? fromRow - dRow : fromRow + dRow)
    } else {
      // 帅/将/车/炮/兵直线进退: 数字为步数
      const steps = STEPS[targetStr]
      if (steps === undefined) return null
      toCol = fromCol
      toRow = isRedTurn
        ? (forward ? fromRow + steps : fromRow - steps)
        : (forward ? fromRow - steps : fromRow + steps)
    }
  }

  if (toCol < 0 || toCol > 8 || toRow < 0 || toRow > 9) return null

  return { from: { col: fromCol, row: fromRow }, to: { col: toCol, row: toRow } }
}

// ── PGN 导出 ──────────────────────────────────────────────────────

export function exportPGN(game: Game): string {
  const lines: string[] = []
  const headerOrder = ['Game', 'Event', 'Site', 'Date', 'Round', 'RedTeam', 'Red', 'BlackTeam', 'Black', 'Result', 'ECCO', 'FEN', 'Format', 'PlyCount', 'Source']
  const written = new Set<string>()

  for (const key of headerOrder) {
    if (game.header[key] !== undefined) {
      lines.push(`[${key} "${game.header[key]}"]`)
      written.add(key)
    }
  }
  for (const [key, value] of Object.entries(game.header)) {
    if (!written.has(key)) lines.push(`[${key} "${value}"]`)
  }
  lines.push('')

  let moveText = ''
  for (let i = 0; i < game.plies.length; i++) {
    const ply = game.plies[i]
    if (i % 2 === 0) moveText += `${Math.floor(i / 2) + 1}. `
    moveText += ply.moveCn + ' '
    if ((i + 1) % 8 === 0 || i === game.plies.length - 1) {
      lines.push(moveText.trim())
      moveText = ''
    }
  }

  if (game.result && game.result !== '*') { lines.push(''); lines.push(game.result) }
  return lines.join('\n')
}

export function exportUCI(game: Game): string {
  return game.plies.map(p => p.move).join(' ')
}
