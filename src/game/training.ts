/**
 * 个人训练计划 - 规划 V3"个人弱点分析 → 自动生成训练计划"
 *
 * 基于战绩/弱点分析/错题本数据，生成有理由、有入口的行动清单。
 * 纯规则推导，不依赖引擎。
 */

import type { WeaknessAnalysis, MistakeItem } from './storage'

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
