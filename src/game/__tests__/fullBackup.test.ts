/**
 * 全量备份测试：合并语义（战绩取最大 / 错题去重 / 掌握度并集）与旧格式兼容
 */
import { describe, it, expect } from 'vitest'
import {
  mergeQuizStats, mergeQuizMistakes,
  type QuizStats, type QuizMistake,
} from '../storage'

const stats = (asked: number, right: number, bestStreak: number): QuizStats =>
  ({ asked, right, bestStreak })

const mistake = (fen: string, masterUci: string, date: number): QuizMistake => ({
  fen, turn: 'w', masterUci, masterMoveCn: '炮二平五', date,
})

describe('mergeQuizStats', () => {
  it('各项取最大值', () => {
    expect(mergeQuizStats(stats(10, 5, 3), stats(8, 7, 2)))
      .toEqual(stats(10, 7, 3))
  })

  it('空侧不影响另一侧', () => {
    expect(mergeQuizStats(stats(0, 0, 0), stats(6, 4, 2))).toEqual(stats(6, 4, 2))
  })
})

describe('mergeQuizMistakes', () => {
  it('按 局面+大师着法 去重，保留较新日期', () => {
    const cur = [mistake('fenA', 'h2e2', 100), mistake('fenB', 'b2e2', 90)]
    const inc = [mistake('fenA', 'h2e2', 200), mistake('fenC', 'c3c4', 150)]
    const merged = mergeQuizMistakes(cur, inc)
    // 排序按合并后的日期新→旧：fenA(200) → fenC(150) → fenB(90)
    expect(merged.map(m => m.fen)).toEqual(['fenA', 'fenC', 'fenB'])
    expect(merged.find(m => m.fen === 'fenA')!.date).toBe(200)
  })

  it('结果按日期新→旧且截断到 50 条', () => {
    const many: QuizMistake[] = Array.from({ length: 60 }, (_, i) =>
      mistake(`f${i}`, `m${i}`, i))
    const merged = mergeQuizMistakes([], many)
    expect(merged.length).toBe(50)
    expect(merged[0].date).toBe(59)
    expect(merged[49].date).toBe(10)
  })

  it('非法条目被过滤', () => {
    const bad = [{ ...mistake('x', 'y', 1), fen: '' }, null as unknown as QuizMistake]
    expect(mergeQuizMistakes([], bad)).toEqual([])
  })
})
