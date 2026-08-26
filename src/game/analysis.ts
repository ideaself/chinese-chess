/**
 * 复盘分析工具：局面阶段划分（子力启发式）与着法精准度
 */
import type { Game } from './model'

/** 大子（车马炮）数量：从 FEN 棋盘段统计双方合计，初始 14 */
function majorPieces(fenBoard: string): number {
  let n = 0
  for (const ch of fenBoard) {
    if (ch === 'R' || ch === 'N' || ch === 'C' || ch === 'r' || ch === 'n' || ch === 'c') n++
  }
  return n
}

export interface PhaseBounds {
  /** 开局结束（进入中局）的手数，0 表示全程开局 */
  mid: number
  /** 中局结束（进入残局）的手数，-1 表示无残局 */
  end: number
}

/**
 * 阶段划分（仿天天象棋「10(中局) 33(残局)」）：
 * - 中局：第一次吃子发生处，最迟第 12 手
 * - 残局：双方大子合计 ≤ 5 处（且晚于中局）
 */
export function phaseBounds(game: Game): PhaseBounds {
  let mid = -1
  let end = -1
  let prevMajors = 14
  for (let i = 0; i < game.plies.length; i++) {
    const boardPart = game.plies[i].fenAfter.split(' ')[0]
    const majors = majorPieces(boardPart)
    if (mid < 0 && (majors < prevMajors || i >= 12)) mid = i
    if (mid >= 0 && end < 0 && i > mid && majors <= 5) end = i
    prevMajors = majors
  }
  return { mid: mid < 0 ? 0 : mid, end }
}

/** 阶段名称区间（供报告页展示） */
export function phaseRanges(game: Game): { label: string; from: number; to: number }[] {
  const { mid, end } = phaseBounds(game)
  const total = game.plies.length
  const ranges = [
    { label: '开局', from: 0, to: mid },
    { label: '中局', from: mid, to: end < 0 ? total : end },
  ]
  if (end >= 0) ranges.push({ label: '残局', from: end, to: total })
  return ranges.filter(r => r.to > r.from)
}

/** 着法平均损失（厘兵）→ 精准度百分比（0-100） */
export function accuracyFromAvgLoss(avgLoss: number): number {
  return Math.round(100 * Math.exp(-Math.max(0, avgLoss) / 300))
}
