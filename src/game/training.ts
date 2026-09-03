/**
 * 个人训练计划 - 规划 V3"个人弱点分析 → 自动生成训练计划"
 *
 * 基于战绩/弱点分析/错题本数据，生成有理由、有入口的行动清单。
 * 纯规则推导，不依赖引擎。
 */

import type { WeaknessAnalysis, MistakeItem } from './storage'
import { getPuzzles, difficultyFromDrop } from './puzzles'
import type { PuzzleItem } from './puzzles'
import { getTrainingProgress } from './progress'

export type PlanAction =
  | { type: 'retry-mistakes' }
  | { type: 'analyze-games' }
  | { type: 'endgame-training' }
  | { type: 'opening-training' }

export interface TrainingPlanItem {
  title: string
  reason: string
  action: PlanAction
  /** 按钮文案 */
  actionLabel: string
}

export interface TrainingPlan {
  items: TrainingPlanItem[]
}

const PHASE_NAMES: Record<string, string> = {
  opening: '开局',
  middle: '中局',
  endgame: '残局',
}

/**
 * 生成个人训练计划
 * @param weakness 弱点分析（可能为 null：样本不足）
 * @param mistakes 错题列表
 * @param unanalyzedGames 未做整盘分析的对局数
 * @param winRate 胜率(0-100)，totalGames 总局数
 */
export function generateTrainingPlan(
  weakness: WeaknessAnalysis | null,
  mistakes: MistakeItem[],
  unanalyzedGames: number,
  winRate: number,
  totalGames: number,
): TrainingPlan | null {
  const items: TrainingPlanItem[] = []

  // 1. 待练习错题优先
  const todoMistakes = mistakes.length // getMistakes 已按调用方过滤? 这里拿全量
  if (todoMistakes >= 3) {
    items.push({
      title: `重走 ${Math.min(todoMistakes, 10)} 道错题`,
      reason: `错题本中有 ${todoMistakes} 个待练习失误，重走是纠正习惯最直接的方式`,
      action: { type: 'retry-mistakes' },
      actionLabel: '去错题本',
    })
  }

  // 2. 最弱阶段专项
  if (weakness?.weakestPhase) {
    const phase = weakness[weakness.weakestPhase]
    items.push({
      title: `加强${PHASE_NAMES[weakness.weakestPhase]}练习`,
      reason: `${PHASE_NAMES[weakness.weakestPhase]}阶段平均损失 ${(phase.lossSum / phase.plies / 100).toFixed(2)} 兵/步、${phase.errors} 次明显失误，是当前短板`,
      action:
        weakness.weakestPhase === 'opening'
          ? { type: 'opening-training' }
          : weakness.weakestPhase === 'endgame'
            ? { type: 'endgame-training' }
            : { type: 'analyze-games' },
      actionLabel: weakness.weakestPhase === 'opening' ? '去开局训练' : weakness.weakestPhase === 'endgame' ? '去残局训练' : '去复盘棋谱',
    })
  }

  // 3. 积压未复盘的对局
  if (unanalyzedGames >= 2) {
    items.push({
      title: `复盘最近 ${Math.min(unanalyzedGames, 5)} 局对局`,
      reason: `有 ${unanalyzedGames} 局尚未整盘分析，复盘数据是训练计划的基础`,
      action: { type: 'analyze-games' },
      actionLabel: '去棋谱页',
    })
  }

  // 4. 胜率偏低时的建议
  if (totalGames >= 8 && winRate < 40) {
    items.push({
      title: '降低 AI 难度重建信心',
      reason: `近 ${totalGames} 局胜率 ${winRate.toFixed(0)}%，建议降一档难度巩固基本功，连胜后再回升`,
      action: { type: 'analyze-games' },
      actionLabel: '先复盘找原因',
    })
  } else if (totalGames >= 8 && winRate >= 65) {
    items.push({
      title: '挑战更高 AI 难度',
      reason: `胜率已达 ${winRate.toFixed(0)}%，当前难度对你来说偏轻松了`,
      action: { type: 'analyze-games' },
      actionLabel: '继续积累棋谱',
    })
  }

  return items.length > 0 ? { items } : null
}

// ── 自适应出题（v1.21 训练闭环） ──────────────────────────────────

export interface AdaptivePick {
  puzzle: PuzzleItem
  /** 展示文案：如「残局专项 · 中级」 */
  label: string
  reason: string
}

const PUZZLE_TYPE_OF_PHASE: Record<string, PuzzleItem['type']> = {
  opening: '失误题',
  middle: '失误题',
  endgame: '残局题',
}

/**
 * 按弱点与历史正确率自适应选题：
 *   - 题型权重：最弱阶段定向加权；正确率偏低的题型加权
 *   - 难度：总体正确率 ≥85% 偏高级 / ≥60% 中级 / 其余初级（无候选时逐级放宽）
 */
export function pickAdaptivePuzzle(weakness: WeaknessAnalysis | null): AdaptivePick | null {
  const pool = getPuzzles()
  if (!pool || pool.length === 0) return null

  const prog = getTrainingProgress()
  const accuracy = (s: { asked: number; right: number } | undefined) =>
    s && s.asked >= 3 ? s.right / s.asked : null

  // 题型权重
  const weights: Record<PuzzleItem['type'], number> = { '杀局': 1, '失误题': 1, '残局题': 1 }
  const reasons: string[] = []
  if (weakness?.weakestPhase) {
    const t = PUZZLE_TYPE_OF_PHASE[weakness.weakestPhase]
    weights[t] *= 2.5
    const phaseName = weakness.weakestPhase === 'opening' ? '开局' : weakness.weakestPhase === 'middle' ? '中局' : '残局'
    reasons.push(`${phaseName}偏弱，定向强化${t}`)
  }
  for (const t of ['杀局', '失误题', '残局题'] as PuzzleItem['type'][]) {
    const acc = accuracy(prog.puzzle.byType[t])
    if (acc !== null && acc < 0.6) {
      weights[t] *= 1.8
      reasons.push(`${t}正确率 ${Math.round(acc * 100)}%，多练`)
    }
  }

  // 加权随机选题型
  const types = Object.keys(weights) as PuzzleItem['type'][]
  const totalW = types.reduce((sum, t) => sum + weights[t], 0)
  let r = Math.random() * totalW
  let chosenType: PuzzleItem['type'] = '失误题'
  for (const t of types) {
    r -= weights[t]
    if (r <= 0) { chosenType = t; break }
  }

  // 难度目标：按总体正确率
  const overall = accuracy({ asked: Object.values(prog.puzzle.byType).reduce((a, s) => a + s.asked, 0), right: Object.values(prog.puzzle.byType).reduce((a, s) => a + s.right, 0) })
  const targetDiff: '初级' | '中级' | '高级' =
    overall === null ? '中级' : overall >= 0.85 ? '高级' : overall >= 0.6 ? '中级' : '初级'
  // 逐级放宽：目标 → 相邻 → 全部
  const ladder: ('初级' | '中级' | '高级')[] =
    targetDiff === '高级' ? ['高级', '中级', '初级'] : targetDiff === '中级' ? ['中级', '高级', '初级'] : ['初级', '中级', '高级']

  let chosen: PuzzleItem | null = null
  let chosenDiff: '初级' | '中级' | '高级' = targetDiff
  for (const d of ladder) {
    const candidates = pool.filter(p => p.type === chosenType && difficultyFromDrop(p.type, p.score_drop ?? 0) === d)
    if (candidates.length > 0) {
      chosen = candidates[Math.floor(Math.random() * candidates.length)]
      chosenDiff = d
      break
    }
  }
  // 该题型完全无候选 → 任选该类型；再退化任选全库
  if (!chosen) {
    const of = pool.filter(p => p.type === chosenType)
    if (of.length > 0) chosen = of[Math.floor(Math.random() * of.length)]
    else chosen = pool[Math.floor(Math.random() * pool.length)]
  }

  const accTxt = overall === null ? '' : `（总体正确率 ${Math.round(overall * 100)}%）`
  return {
    puzzle: chosen,
    label: `${chosenType} · ${chosenDiff}`,
    reason: (reasons.length > 0 ? reasons.join('；') : '按你的答题记录智能匹配') + accTxt,
  }
}
