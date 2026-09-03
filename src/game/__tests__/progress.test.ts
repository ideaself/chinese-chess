/**
 * 训练进度统一模型测试（v1.21）
 * 题库统计/连对/每日完成/残局通关/错题重练/备份合并
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getTrainingProgress, recordPuzzleAnswer, getPuzzleStreak, isDailyDone,
  recordEndgameResult, recordMistakeRetry, isMistakeAutoMastered,
  mergeTrainingProgress, snapshotTrainingProgress, restoreTrainingProgress,
  todayKey, _resetProgressCacheForTest,
  type TrainingProgress,
} from '../progress'

// ── localStorage stub ──
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  _resetProgressCacheForTest()
})

describe('题库答题统计与连对', () => {
  it('题型/难度统计累计', () => {
    recordPuzzleAnswer({ type: '失误题', difficulty: '中级', correct: true })
    recordPuzzleAnswer({ type: '失误题', difficulty: '中级', correct: false })
    const p = getTrainingProgress()
    expect(p.puzzle.byType['失误题']).toEqual({ asked: 2, right: 1 })
    expect(p.puzzle.byDiff['中级']).toEqual({ asked: 2, right: 1 })
  })

  it('连对：答对 +1（同日只记一次），答错清零', () => {
    recordPuzzleAnswer({ correct: true })
    recordPuzzleAnswer({ correct: true }) // 同日不再 +1
    expect(getPuzzleStreak().count).toBe(1)
    expect(getPuzzleStreak().todayDone).toBe(true)
    recordPuzzleAnswer({ correct: false })
    expect(getPuzzleStreak().count).toBe(0)
    expect(getTrainingProgress().puzzle.bestStreak).toBe(1)
  })

  it('每日挑战完成标记按题型', () => {
    recordPuzzleAnswer({ type: '杀局', correct: true, isDaily: true })
    expect(isDailyDone('杀局')).toBe(true)
    expect(isDailyDone('失误题')).toBe(false)
  })

  it('旧版连对数据迁移后删除旧键', () => {
    store.set('xiangqi-puzzle-streak', '7')
    store.set('xiangqi-puzzle-streak-date', 'Wed Sep 02 2026')
    _resetProgressCacheForTest()
    const s = getPuzzleStreak()
    expect(s.count).toBe(7)
    expect(getTrainingProgress().puzzle.bestStreak).toBe(7)
    expect(store.has('xiangqi-puzzle-streak')).toBe(false)
    expect(store.has('xiangqi-puzzle-streak-date')).toBe(false)
  })
})

describe('残局与错题重练', () => {
  it('残局胜出即通关，失败只计尝试', () => {
    recordEndgameResult('horse-behind-cannon', false)
    recordEndgameResult('horse-behind-cannon', true)
    const e = getTrainingProgress().endgames['horse-behind-cannon']
    expect(e).toMatchObject({ attempts: 2, wins: 1, completed: true })
  })

  it('错题答对 ≥2 次达到自动掌握', () => {
    recordMistakeRetry('fenA|h2e2', true)
    expect(isMistakeAutoMastered('fenA|h2e2')).toBe(false)
    recordMistakeRetry('fenA|h2e2', true)
    expect(isMistakeAutoMastered('fenA|h2e2')).toBe(true)
    recordMistakeRetry('fenA|h2e2', false)
    expect(isMistakeAutoMastered('fenA|h2e2')).toBe(true) // right=2 不回退
  })
})

describe('备份合并', () => {
  const base = (): TrainingProgress => ({
    v: 1,
    puzzle: {
      byType: { '杀局': { asked: 10, right: 6 } },
      byDiff: { '初级': { asked: 10, right: 6 } },
      streak: 3,
      streakDate: 'Wed Sep 02 2026',
      bestStreak: 5,
      dailyDone: { '杀局': '2026-09-01' },
    },
    endgames: { 'rook-king': { attempts: 2, wins: 1, completed: true, lastAt: 100 } },
    mistakeRetries: { 'fenA|h2e2': { attempts: 3, right: 2, lastAt: 100 } },
  })

  it('计数取最大 / 完成并集 / dailyDone 覆盖合并', () => {
    const incoming: TrainingProgress = {
      v: 1,
      puzzle: {
        byType: { '杀局': { asked: 8, right: 7 }, '残局题': { asked: 4, right: 4 } },
        byDiff: {},
        streak: 6,
        streakDate: 'Thu Sep 03 2026',
        bestStreak: 4,
        dailyDone: { '失误题': '2026-09-03' },
      },
      endgames: { 'rook-king': { attempts: 5, wins: 0, completed: false, lastAt: 200 } },
      mistakeRetries: { 'fenB|b2e2': { attempts: 1, right: 1, lastAt: 50 } },
    }
    const merged = mergeTrainingProgress(base(), incoming)
    expect(merged.puzzle.byType['杀局']).toEqual({ asked: 10, right: 7 })
    expect(merged.puzzle.byType['残局题']).toEqual({ asked: 4, right: 4 })
    expect(merged.puzzle.bestStreak).toBe(5)
    expect(merged.puzzle.streak).toBe(6)
    expect(merged.puzzle.streakDate).toBe('Thu Sep 03 2026') // 取 streak 大的一侧日期
    expect(merged.puzzle.dailyDone['杀局']).toBe('2026-09-01')
    expect(merged.puzzle.dailyDone['失误题']).toBe('2026-09-03')
    expect(merged.endgames['rook-king']).toMatchObject({ attempts: 5, wins: 1, completed: true })
    expect(merged.mistakeRetries['fenB|b2e2'].attempts).toBe(1)
  })

  it('restoreTrainingProgress 合并写入并刷新内存', () => {
    recordPuzzleAnswer({ type: '失误题', correct: true })
    const before = snapshotTrainingProgress()
    expect(before.puzzle.byType['失误题'].asked).toBe(1)
    const incoming = base()
    expect(restoreTrainingProgress(incoming)).toBe(true)
    const after = getTrainingProgress()
    expect(after.puzzle.byType['杀局'].asked).toBe(10)
    expect(after.puzzle.byType['失误题'].asked).toBe(1)
    expect(after.puzzle.bestStreak).toBe(5)
  })

  it('restore 拒绝非对象输入', () => {
    expect(restoreTrainingProgress(null)).toBe(false)
    expect(restoreTrainingProgress('x' as unknown as object)).toBe(false)
  })
})

describe('todayKey', () => {
  it('格式 yyyy-mm-dd', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
