/**
 * 训练计划生成器测试（规划 V3）
 */
import { describe, it, expect } from 'vitest'
import { generateTrainingPlan } from '../training'
import type { WeaknessAnalysis, MistakeItem } from '../storage'

const emptyPhase = { plies: 0, lossSum: 0, errors: 0 }

function mkWeakness(weakest: 'opening' | 'middle' | 'endgame'): WeaknessAnalysis {
  return {
    opening: { plies: 20, lossSum: 300, errors: 2 },
    middle: { plies: 40, lossSum: 1600, errors: 5 },
    endgame: { plies: 10, lossSum: 900, errors: 3 },
    weakestPhase: weakest,
    ...(weakest === 'opening' ? {} : {}),
  }
}

function mkMistakes(n: number): MistakeItem[] {
  return Array.from({ length: n }, (_, i) => ({
    gameId: `g${i}`, gameDate: Date.now(), plyIndex: i,
    round: i + 1, moveCn: '车九进一', bestMoveCn: '车九平三',
    classification: 'blunder', moveLoss: 200, key: `k${i}`,
  }))
}

describe('generateTrainingPlan', () => {
  it('无数据时返回 null', () => {
    const plan = generateTrainingPlan(null, [], 0, 50, 0)
    expect(plan).toBeNull()
  })

  it('最弱阶段 → 对应训练入口', () => {
    const w = mkWeakness('endgame')
    // endgame 平均 90 兵? lossSum900/10plies=90 → 最弱
    const plan = generateTrainingPlan(w, [], 0, 55, 20)!
    const item = plan.items.find(i => i.title.includes('残局'))
    expect(item).toBeDefined()
    expect(item!.action.type).toBe('endgame-training')
  })

  it('错题多时建议重走', () => {
    const plan = generateTrainingPlan(null, mkMistakes(8), 0, 60, 15)!
    expect(plan.items.some(i => i.action.type === 'retry-mistakes')).toBe(true)
  })

  it('积压未复盘对局时提醒', () => {
    const plan = generateTrainingPlan(null, [], 4, 60, 12)!
    expect(plan.items.some(i => i.reason.includes('尚未整盘分析'))).toBe(true)
  })

  it('胜率偏低建议降难度 / 偏高建议升难度', () => {
    const low = generateTrainingPlan(null, [], 0, 30, 10)!
    expect(low.items.some(i => i.title.includes('降低'))).toBe(true)
    const high = generateTrainingPlan(null, [], 0, 75, 10)!
    expect(high.items.some(i => i.title.includes('挑战更高'))).toBe(true)
  })
})
