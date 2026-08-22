/**
 * 棋力等级（Elo + 段位）- 计划第19节 V3 / 第22节 C
 *
 * 设计:
 *   - AI 难度对应固定对手分，玩家初始 1200 分
 *   - 标准 Elo 公式，K 值按定级局数与分段递减
 *   - 段位表与 AI 难度对齐：稳定战胜某档 AI ≈ 对应段位门槛
 *   - 仅结算人机对局终局（同局去重），历史保留最近 100 条
 */

import type { Difficulty } from '../store/useStore'

export const DEFAULT_RATING = 1200

/** 各难度 AI 的参考对手分 */
export const OPPONENT_RATING: Record<Difficulty, number> = {
  beginner: 800,
  easy: 1100,
  medium: 1400,
  hard: 1700,
  master: 2000,
  grandmaster: 2300,
}

export type Outcome = 'win' | 'loss' | 'draw'

export interface RankTier {
  /** 进入该段位的最低分 */
  min: number
  name: string
}

/** 段位表（升序） */
export const RANK_TIERS: RankTier[] = [
  { min: 0, name: '初学乍练' },
  { min: 800, name: '十级棋士' },
  { min: 900, name: '九级棋士' },
  { min: 1000, name: '八级棋士' },
  { min: 1100, name: '七级棋士' },
  { min: 1200, name: '六级棋士' },
  { min: 1300, name: '五级棋士' },
  { min: 1400, name: '四级棋士' },
  { min: 1500, name: '三级棋士' },
  { min: 1600, name: '二级棋士' },
  { min: 1700, name: '一级棋士' },
  { min: 1800, name: '业余初段' },
  { min: 1950, name: '业余二段' },
  { min: 2100, name: '业余三段' },
  { min: 2250, name: '业余四段' },
  { min: 2400, name: '象棋大师' },
]

// ── 持久化 ────────────────────────────────────────────────────────

const RATING_KEY = 'xiangqi_rating'
const HISTORY_CAP = 100

export interface RatingRecord {
  gameId: string
  at: number
  difficulty: Difficulty
  outcome: Outcome
  /** 对手参考分 */
  opponent: number
  before: number
  after: number
}

export interface RatingState {
  rating: number
  /** 结算记录，新→旧 */
  history: RatingRecord[]
}

function loadState(): RatingState {
  try {
    const raw = localStorage.getItem(RATING_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.rating === 'number') {
        return { rating: parsed.rating, history: Array.isArray(parsed.history) ? parsed.history : [] }
      }
    }
  } catch {}
  return { rating: DEFAULT_RATING, history: [] }
}

function persist(state: RatingState): void {
  try {
    localStorage.setItem(RATING_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('保存棋力分失败:', e)
  }
}

export function getRatingState(): RatingState {
  return loadState()
}

export function resetRating(): void {
  localStorage.removeItem(RATING_KEY)
}

// ── Elo 计算 ──────────────────────────────────────────────────────

/** 期望胜率 */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400))
}

/** K 值：定级期 40，之后按分段递减 */
export function kFactor(rating: number, ratedGames: number): number {
  if (ratedGames < 15) return 40
  if (rating < 2000) return 24
  return 16
}

/** 单局后的新分（四舍五入） */
export function computeNewRating(
  current: number,
  opponentRating: number,
  outcome: Outcome,
  ratedGames: number,
): number {
  const score = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0
  const expected = expectedScore(current, opponentRating)
  const k = kFactor(current, ratedGames)
  return Math.round(current + k * (score - expected))
}

export interface RatingChange {
  before: number
  after: number
  delta: number
}

/**
 * 结算一局人机对局。
 * @returns 分数变化；同一 gameId 已结算过或参数非法时返回 null
 */
export function applyGameResult(
  gameId: string,
  difficulty: Difficulty,
  outcome: Outcome,
): RatingChange | null {
  if (!OPPONENT_RATING[difficulty]) return null
  const state = loadState()
  if (state.history.some(r => r.gameId === gameId)) return null // 同局只结算一次

  const opponent = OPPONENT_RATING[difficulty]
  const before = state.rating
  const after = computeNewRating(before, opponent, outcome, state.history.length)

  state.history.unshift({
    gameId,
    at: Date.now(),
    difficulty,
    outcome,
    opponent,
    before,
    after,
  })
  if (state.history.length > HISTORY_CAP) state.history.length = HISTORY_CAP

  persist({ rating: after, history: state.history })
  return { before, after, delta: after - before }
}

// ── 段位查询 ──────────────────────────────────────────────────────

export interface RankInfo {
  tier: RankTier
  /** 下一段位；已到顶为 null */
  next: RankTier | null
  /** 距下一档进度 0..1；到顶为 1 */
  progress: number
  /** 距下一档还差多少分；到顶为 0 */
  toNext: number
}

export function getRank(rating: number): RankInfo {
  let idx = 0
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (rating >= RANK_TIERS[i].min) { idx = i; break }
  }
  const tier = RANK_TIERS[idx]
  const next = idx + 1 < RANK_TIERS.length ? RANK_TIERS[idx + 1] : null
  if (!next) return { tier, next: null, progress: 1, toNext: 0 }
  return {
    tier,
    next,
    progress: Math.min(1, (rating - tier.min) / (next.min - tier.min)),
    toNext: next.min - rating,
  }
}
