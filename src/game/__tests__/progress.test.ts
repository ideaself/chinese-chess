/**
 * 训练进度统一模型测试（v1.21）
 * 题库统计/连对/每日完成/残局通关/错题重练/备份合并
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getTrainingProgress, recordPuzzleAnswer, getPuzzleStreak, isDailyDone,
  recordEndgameResult, recordMistakeRetry, isMistakeAutoMastered,
  amendPuzzleWrongToRight, nextDueAt, isPuzzleDue, duePuzzleKeys, dueMistakeKeys,
  recordOpeningStart, recordOpeningDone,
  SRS_INTERVALS_DAYS,
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

  it('引擎追认正确：答错回滚为答对（asked 不变、right +1、连对恢复）', () => {
    recordPuzzleAnswer({ type: '失误题', difficulty: '高级', correct: false })
    expect(getTrainingProgress().puzzle.byType['失误题']).toEqual({ asked: 1, right: 0 })
    expect(getPuzzleStreak().count).toBe(0)

    amendPuzzleWrongToRight({ type: '失误题', difficulty: '高级' })

    const p = getTrainingProgress()
    expect(p.puzzle.byType['失误题']).toEqual({ asked: 1, right: 1 })
    expect(p.puzzle.byDiff['高级']).toEqual({ asked: 1, right: 1 })
    expect(getPuzzleStreak().count).toBe(1)
  })

  it('追认正确：没有历史记录时不会出现负数', () => {
    amendPuzzleWrongToRight({ type: '杀局', difficulty: '中级' })
    const p = getTrainingProgress()
    expect(p.puzzle.byType['杀局']).toEqual({ asked: 1, right: 1 })
    expect(p.puzzle.byDiff['中级']).toEqual({ asked: 1, right: 1 })
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

describe('SRS 间隔复习', () => {
  const DAY = 24 * 3600 * 1000

  it('答对逐级延长间隔：1 → 3 → 7 天', () => {
    const t0 = Date.now()
    recordPuzzleAnswer({ type: '失误题', difficulty: '高级', correct: true, key: 'fenA|e0e1' })
    let srs = getTrainingProgress().puzzle.srs['fenA|e0e1']
    expect(srs.stage).toBe(1)
    expect(srs.dueAt).toBeGreaterThanOrEqual(t0 + SRS_INTERVALS_DAYS[0] * DAY - 1000)
    expect(srs.dueAt).toBeLessThanOrEqual(Date.now() + SRS_INTERVALS_DAYS[0] * DAY + 1000)

    recordPuzzleAnswer({ type: '失误题', difficulty: '高级', correct: true, key: 'fenA|e0e1' })
    srs = getTrainingProgress().puzzle.srs['fenA|e0e1']
    expect(srs.stage).toBe(2)
    expect(srs.dueAt).toBeGreaterThanOrEqual(Date.now() + SRS_INTERVALS_DAYS[1] * DAY - 1000)
  })

  it('答错归零并安排 10 分钟后再来', () => {
    recordPuzzleAnswer({ correct: true, key: 'fenB|e0e1' })
    recordPuzzleAnswer({ correct: true, key: 'fenB|e0e1' })
    recordPuzzleAnswer({ correct: false, key: 'fenB|e0e1' })
    const srs = getTrainingProgress().puzzle.srs['fenB|e0e1']
    expect(srs.stage).toBe(0)
    expect(srs.dueAt - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000 + 1000)
  })

  it('未练过的题视为可练，练过未到期则不在复习队列', () => {
    expect(isPuzzleDue('never|e0e1')).toBe(true)
    recordPuzzleAnswer({ correct: true, key: 'fenC|e0e1' })
    expect(isPuzzleDue('fenC|e0e1')).toBe(false)
    expect(duePuzzleKeys()).not.toContain('fenC|e0e1')
  })

  it('到期题目按最早到期优先进入复习队列', () => {
    const now = Date.now()
    const p = getTrainingProgress()
    p.puzzle.srs['late|e0e1'] = { stage: 1, dueAt: now + DAY, lastAt: now }
    p.puzzle.srs['early|e0e1'] = { stage: 1, dueAt: now - DAY, lastAt: now - 2 * DAY }
    p.puzzle.srs['mid|e0e1'] = { stage: 1, dueAt: now - 1000, lastAt: now - DAY }
    expect(duePuzzleKeys(now)).toEqual(['early|e0e1', 'mid|e0e1'])
  })

  it('错题重练同样排期：答对升级、答错归零', () => {
    recordMistakeRetry('fenD|e0e1', true)
    let s = getTrainingProgress().mistakeRetries['fenD|e0e1']
    expect(s.stage).toBe(1)
    expect(s.dueAt!).toBeGreaterThan(Date.now())
    recordMistakeRetry('fenD|e0e1', false)
    s = getTrainingProgress().mistakeRetries['fenD|e0e1']
    expect(s.stage).toBe(0)
  })

  it('到期的错题进入复习队列（未排期的老数据也算到期）', () => {
    recordMistakeRetry('fenE|e0e1', true) // 排到 1 天后
    recordMistakeRetry('fenF|e0e1', false) // 排到 10 分钟后
    // 旧版数据没有 dueAt（缺省 0）→ 视为立即可复习
    getTrainingProgress().mistakeRetries['legacy|e0e1'] = { attempts: 1, right: 0, lastAt: 0 }
    const due = dueMistakeKeys()
    expect(due).toContain('legacy|e0e1')
    expect(due).not.toContain('fenE|e0e1')
    expect(due).not.toContain('fenF|e0e1')
  })

  it('引擎追认后 SRS 按答对排期', () => {
    recordPuzzleAnswer({ type: '失误题', difficulty: '高级', correct: false, key: 'fenG|e0e1' })
    expect(getTrainingProgress().puzzle.srs['fenG|e0e1'].stage).toBe(0)
    amendPuzzleWrongToRight({ type: '失误题', difficulty: '高级', key: 'fenG|e0e1' })
    expect(getTrainingProgress().puzzle.srs['fenG|e0e1'].stage).toBe(1)
  })

  it('nextDueAt：阶段超出序列时取最长间隔', () => {
    const now = 0
    expect(nextDueAt(0, true, now)).toBe(SRS_INTERVALS_DAYS[0] * DAY)
    expect(nextDueAt(99, true, now)).toBe(SRS_INTERVALS_DAYS[SRS_INTERVALS_DAYS.length - 1] * DAY)
    expect(nextDueAt(3, false, now)).toBe(10 * 60 * 1000)
  })

  it('备份合并：SRS 阶段取较大、到期取较早', () => {
    const cur = snapshotTrainingProgress()
    cur.puzzle.srs['x|e0e1'] = { stage: 2, dueAt: 500, lastAt: 100 }
    const inc = snapshotTrainingProgress()
    inc.puzzle.srs['x|e0e1'] = { stage: 4, dueAt: 300, lastAt: 200 }
    const merged = mergeTrainingProgress(cur, inc)
    expect(merged.puzzle.srs['x|e0e1']).toEqual({ stage: 4, dueAt: 300, lastAt: 200 })
  })
})
describe('开局训练进度', () => {
  it('开始计尝试、走完记掌握', () => {
    recordOpeningStart('book:h2e2')
    recordOpeningStart('book:h2e2')
    let o = getTrainingProgress().openings['book:h2e2']
    expect(o).toMatchObject({ attempts: 2, completed: false })
    recordOpeningDone('book:h2e2')
    o = getTrainingProgress().openings['book:h2e2']
    expect(o.completed).toBe(true)
    expect(o.attempts).toBe(2)
  })

  it('未训练过的线路无记录', () => {
    expect(getTrainingProgress().openings['book:zzz']).toBeUndefined()
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
      srs: { 'fenA|e0e1': { stage: 2, dueAt: 500, lastAt: 100 } },
    },
    endgames: { 'rook-king': { attempts: 2, wins: 1, completed: true, lastAt: 100 } },
    openings: { 'book:h2e2': { attempts: 3, completed: true, lastAt: 100 } },
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
        srs: { 'fenA|e0e1': { stage: 3, dueAt: 300, lastAt: 200 }, 'fenB|e0e1': { stage: 1, dueAt: 900, lastAt: 150 } },
      },
      endgames: { 'rook-king': { attempts: 5, wins: 0, completed: false, lastAt: 200 } },
      openings: { 'book:h2e2': { attempts: 1, completed: false, lastAt: 300 }, 'book:c3c4': { attempts: 2, completed: true, lastAt: 150 } },
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
    expect(merged.openings['book:h2e2']).toMatchObject({ attempts: 3, completed: true })
    expect(merged.openings['book:c3c4']).toMatchObject({ attempts: 2, completed: true })
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
