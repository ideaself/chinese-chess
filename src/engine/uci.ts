/**
 * UCI 走法解析与转换
 * 
 * Pikafish 使用 UCI 格式: e2e4 (col字母 + row数字，row 从 0 开始)
 */

import type { Move, Pos } from '../game/board'
import { coordToPos, posToCoord } from '../game/board'

/** 将内部 Move 转为 UCI 字符串 */
export function moveToUci(move: Move): string {
  return `${posToCoord(move.from)}${posToCoord(move.to)}`
}

/** 将 UCI 字符串转为内部 Move */
export function uciToMove(uci: string): Move {
  if (uci.length < 4) {
    throw new Error(`无效的 UCI 走法: ${uci}`)
  }
  return {
    from: coordToPos(uci.slice(0, 2)),
    to: coordToPos(uci.slice(2, 4)),
    turn: 'w' as any, // 由调用方设置
  }
}

/** 检查 UCI 走法格式是否合法 */
export function isValidUci(uci: string): boolean {
  if (uci.length < 4) return false
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  if (!/^[a-i][0-9]$/.test(from)) return false
  if (!/^[a-i][0-9]$/.test(to)) return false
  return true
}

/** 获取引擎思考时的最佳走法并转换为内部格式 */
export function parseBestMove(output: string): string | null {
  const match = output.match(/bestmove\s+(\S+)/)
  return match ? match[1] : null
}
