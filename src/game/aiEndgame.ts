/**
 * AI 收官纠偏
 *
 * Pikafish 在大优残局里常在多个近似赢法间摇摆：反复将军、迟迟不吃子/推进，
 * 实测加时（18s→60s）也不会改善（搜索越深越偏好"零风险"的将军/等着）。
 * 这里在应用层做一个兜底：当引擎选的是将军着、且近几手 AI 也在反复将军、
 * 局面评估已是大优（又非杀棋分）时，改从 MultiPV 候选里挑一手分数接近的
 * 非将军着法，强制转入收官。
 */
import type { BoardState, Turn } from './board'
import { makeMove } from './board'
import { isInCheck } from './rules'
import type { Game } from './model'

/** 触发的评估下限（厘兵）。低于此值说明优势未确认，将军可能是在争取和棋 */
export const ENDGAME_CORRECT_MIN_SCORE = 400
/** 非将军候选允许的评估落差（厘兵），避免纠偏反而走劣着 */
export const ENDGAME_CORRECT_MAX_GAP = 50
/** 回看 AI 最近多少手 */
export const ENDGAME_CORRECT_WINDOW = 4
/** 最近这些手中有几手将军才触发 */
export const ENDGAME_CORRECT_MIN_CHECKS = 2
/** 绝对值达到该分数视为杀棋分（parseInfo 把 mate 映射到 ±100000 附近） */
export const ENDGAME_MATE_SCORE = 90000

const UCI_RE = /^[a-i][0-9][a-i][0-9]$/

/** 一步 UCI 着法在给定局面上是否将军（含非法/越界兜底） */
export function moveGivesCheck(board: BoardState, uci: string): boolean {
  if (!UCI_RE.test(uci)) return false
  const from = { col: uci.charCodeAt(0) - 97, row: Number(uci[1]) }
  const to = { col: uci.charCodeAt(2) - 97, row: Number(uci[3]) }
  const piece = board.board[from.col]?.[from.row]
  if (!piece || piece === '.') return false
  const next = makeMove(board, { from, to, turn: board.turn })
  return isInCheck(next)
}

/**
 * 是否应做收官纠偏：大优、非杀棋、当前不是被将军，且引擎这手是将军、
 * AI 近几手已反复将军。
 */
export function shouldCorrectRepeatedCheck(
  game: Game,
  board: BoardState,
  uci: string,
  score: number | null,
): boolean {
  if (score === null || score < ENDGAME_CORRECT_MIN_SCORE || score >= ENDGAME_MATE_SCORE) return false
  // 被将军时优先应将，不干预
  if (isInCheck(board)) return false
  if (!moveGivesCheck(board, uci)) return false

  const aiSide: Turn = board.turn
  const recent = game.plies.filter(p => p.turn === aiSide).slice(-ENDGAME_CORRECT_WINDOW)
  const checks = recent.filter(p => p.inCheck).length
  return checks >= ENDGAME_CORRECT_MIN_CHECKS
}

export interface EngineCandidate {
  move: string
  score: number
}

/**
 * 从 MultiPV 候选中挑一手分数接近且不将军的着法；没有则返回 null。
 * `bestScore` 为候选第一名分数（null 表示不限制落差）。
 */
export function pickNonCheckingCandidate<T extends EngineCandidate>(
  lines: T[],
  board: BoardState,
  bestScore: number | null,
): T | null {
  const limit = bestScore === null ? -Infinity : bestScore - ENDGAME_CORRECT_MAX_GAP
  for (const line of lines) {
    if (!line.move || line.move.length < 4) continue
    if (line.score < limit) continue
    if (moveGivesCheck(board, line.move)) continue
    return line
  }
  return null
}
