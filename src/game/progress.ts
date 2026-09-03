/**
 * 训练进度统一模型（v1.21 训练闭环）
 *
 * 聚合三类训练数据，localStorage 同步 API，随全量备份合并/恢复：
 *   - 实战题库：按题型/难度的答题统计 + 连对 streak + 每日挑战完成标记
 *   - 残局练习：按定式的尝试/胜出/通关记录
 *   - 错题重练：错题本重走的答题记录（连对 2 次自动掌握）
 */

const PROGRESS_KEY = 'xiangqi_training_progress'

// 旧版连对数据（puzzles.ts 原有键），迁移后废弃
const LEGACY_STREAK_KEY = 'xiangqi-puzzle-streak'
const LEGACY_STREAK_DATE_KEY = 'xiangqi-puzzle-streak-date'

export interface TypeStat {
  /** 答题次数 */
  asked: number
  /** 答对次数 */
  right: number
}

export interface EndgameStat {
  attempts: number
  wins: number
  /** 至少胜出一次即通关 */
  completed: boolean
  lastAt: number
}

export interface MistakeRetryStat {
  attempts: number
  right: number
  lastAt: number
}

export interface TrainingProgress {
  v: 1
  puzzle: {
    /** key: PuzzleType（杀局/失误题/残局题） */
    byType: Record<string, TypeStat>
    /** key: 初级/中级/高级 */
    byDiff: Record<string, TypeStat>
    streak: number
    /** streak 所在日期（new Date().toDateString()） */
    streakDate: string
    bestStreak: number
    /** key: 题型 → 最近完成每日挑战的日期（yyyy-mm-dd） */
    dailyDone: Record<string, string>
  }
  /** key: 残局定式 id */
  endgames: Record<string, EndgameStat>
  /** key: 错题去重键（局面|着法） */
  mistakeRetries: Record<string, MistakeRetryStat>
}

function emptyProgress(): TrainingProgress {
  return {
    v: 1,
    puzzle: { byType: {}, byDiff: {}, streak: 0, streakDate: '', bestStreak: 0, dailyDone: {} },
    endgames: {},
    mistakeRetries: {},
  }
}

let cached: TrainingProgress | null = null

function normalize(raw: unknown): TrainingProgress {
  const d = (raw ?? {}) as Partial<TrainingProgress>
  const out = emptyProgress()
  if (d.puzzle && typeof d.puzzle === 'object') {
    out.puzzle = {
      byType: { ...(d.puzzle.byType ?? {}) },
      byDiff: { ...(d.puzzle.byDiff ?? {}) },
      streak: d.puzzle.streak | 0,
      streakDate: typeof d.puzzle.streakDate === 'string' ? d.puzzle.streakDate : '',
      bestStreak: d.puzzle.bestStreak | 0,
      dailyDone: { ...(d.puzzle.dailyDone ?? {}) },
    }
  }
  if (d.endgames && typeof d.endgames === 'object') out.endgames = { ...(d.endgames as TrainingProgress['endgames']) }
  if (d.mistakeRetries && typeof d.mistakeRetries === 'object') out.mistakeRetries = { ...(d.mistakeRetries as TrainingProgress['mistakeRetries']) }
  return out
}

export function getTrainingProgress(): TrainingProgress {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (raw) {
      cached = normalize(JSON.parse(raw))
      return cached
    }
    // 迁移旧版连对数据（只迁移一次，迁移后旧键删除）
    const legacyStreak = parseInt(localStorage.getItem(LEGACY_STREAK_KEY) || '0', 10) || 0
    const legacyDate = localStorage.getItem(LEGACY_STREAK_DATE_KEY) || ''
    cached = emptyProgress()
    if (legacyStreak > 0) {
      cached.puzzle.streak = legacyStreak
      cached.puzzle.streakDate = legacyDate
      cached.puzzle.bestStreak = legacyStreak
      localStorage.removeItem(LEGACY_STREAK_KEY)
      localStorage.removeItem(LEGACY_STREAK_DATE_KEY)
      persist()
    }
    return cached
  } catch {
    cached = emptyProgress()
    return cached
  }
}

function persist(): void {
  if (!cached) return
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(cached)) } catch { /* 空间超限则放弃 */ }
}

export function getPuzzleStreak(): { count: number; todayDone: boolean } {
  const p = getTrainingProgress()
  return { count: p.puzzle.streak, todayDone: p.puzzle.streakDate === new Date().toDateString() && p.puzzle.streak > 0 }
}

/** 答题：更新题型/难度统计与连对；isDaily 时标记当日完成 */
export function recordPuzzleAnswer(opts: { type?: string; difficulty?: string; correct: boolean; isDaily?: boolean }): void {
  const p = getTrainingProgress()
  const q = p.puzzle
  if (opts.type) {
    const s = q.byType[opts.type] ?? { asked: 0, right: 0 }
    s.asked++
    if (opts.correct) s.right++
    q.byType[opts.type] = s
  }
  if (opts.difficulty) {
    const s = q.byDiff[opts.difficulty] ?? { asked: 0, right: 0 }
    s.asked++
    if (opts.correct) s.right++
    q.byDiff[opts.difficulty] = s
  }
  // 连对：答对且当日未记 → +1；答错 → 清零（原 puzzles.ts 语义）
  if (opts.correct) {
    if (q.streakDate !== new Date().toDateString()) {
      q.streak++
      q.streakDate = new Date().toDateString()
      if (q.streak > q.bestStreak) q.bestStreak = q.streak
    }
  } else {
    q.streak = 0
    q.streakDate = ''
  }
  if (opts.isDaily && opts.type) {
    q.dailyDone[opts.type] = todayKey()
  }
  persist()
}

/** 每日挑战是否已完成（按题型） */
export function isDailyDone(type: string): boolean {
  const p = getTrainingProgress()
  return p.puzzle.dailyDone[type] === todayKey()
}

export function recordEndgameResult(presetId: string, won: boolean): void {
  const p = getTrainingProgress()
  const s = p.endgames[presetId] ?? { attempts: 0, wins: 0, completed: false, lastAt: 0 }
  s.attempts++
  if (won) { s.wins++; s.completed = true }
  s.lastAt = Date.now()
  p.endgames[presetId] = s
  persist()
}

export function recordMistakeRetry(key: string, correct: boolean): void {
  const p = getTrainingProgress()
  const s = p.mistakeRetries[key] ?? { attempts: 0, right: 0, lastAt: 0 }
  s.attempts++
  if (correct) s.right++
  s.lastAt = Date.now()
  p.mistakeRetries[key] = s
  persist()
}

/** 是否达到自动掌握标准（该错题累计答对 ≥2 次） */
export function isMistakeAutoMastered(key: string): boolean {
  const s = getTrainingProgress().mistakeRetries[key]
  return !!s && s.right >= 2
}

/** 今日日期键 yyyy-mm-dd */
export function todayKey(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ── 备份合并（各项计数取最大，通关/完成标记并集） ──────────────────

function mergeStat(a: TypeStat | undefined, b: TypeStat | undefined): TypeStat {
  return { asked: Math.max(a?.asked ?? 0, b?.asked ?? 0), right: Math.max(a?.right ?? 0, b?.right ?? 0) }
}

export function mergeTrainingProgress(current: TrainingProgress, incoming: TrainingProgress): TrainingProgress {
  const out: TrainingProgress = {
    v: 1,
    puzzle: {
      byType: {},
      byDiff: {},
      streak: Math.max(current.puzzle.streak, incoming.puzzle.streak),
      // 连对日期取与较大 streak 对应的一侧
      streakDate: incoming.puzzle.streak > current.puzzle.streak ? incoming.puzzle.streakDate : current.puzzle.streakDate,
      bestStreak: Math.max(current.puzzle.bestStreak, incoming.puzzle.bestStreak),
      dailyDone: { ...current.puzzle.dailyDone, ...incoming.puzzle.dailyDone },
    },
    endgames: {},
    mistakeRetries: {},
  }
  const typeKeys = new Set([...Object.keys(current.puzzle.byType), ...Object.keys(incoming.puzzle.byType)])
  for (const k of typeKeys) out.puzzle.byType[k] = mergeStat(current.puzzle.byType[k], incoming.puzzle.byType[k])
  const diffKeys = new Set([...Object.keys(current.puzzle.byDiff), ...Object.keys(incoming.puzzle.byDiff)])
  for (const k of diffKeys) out.puzzle.byDiff[k] = mergeStat(current.puzzle.byDiff[k], incoming.puzzle.byDiff[k])

  const egKeys = new Set([...Object.keys(current.endgames), ...Object.keys(incoming.endgames)])
  for (const k of egKeys) {
    const a = current.endgames[k]
    const b = incoming.endgames[k]
    out.endgames[k] = {
      attempts: Math.max(a?.attempts ?? 0, b?.attempts ?? 0),
      wins: Math.max(a?.wins ?? 0, b?.wins ?? 0),
      completed: !!(a?.completed || b?.completed),
      lastAt: Math.max(a?.lastAt ?? 0, b?.lastAt ?? 0),
    }
  }
  const mkKeys = new Set([...Object.keys(current.mistakeRetries), ...Object.keys(incoming.mistakeRetries)])
  for (const k of mkKeys) {
    const a = current.mistakeRetries[k]
    const b = incoming.mistakeRetries[k]
    out.mistakeRetries[k] = {
      attempts: Math.max(a?.attempts ?? 0, b?.attempts ?? 0),
      right: Math.max(a?.right ?? 0, b?.right ?? 0),
      lastAt: Math.max(a?.lastAt ?? 0, b?.lastAt ?? 0),
    }
  }
  return out
}

/** 备份用快照（深拷贝，避免恢复合并污染内存态） */
export function snapshotTrainingProgress(): TrainingProgress {
  return normalize(JSON.parse(JSON.stringify(getTrainingProgress())))
}

/** 从备份恢复（合并语义，写回并刷新内存缓存） */
export function restoreTrainingProgress(incoming: unknown): boolean {
  if (!incoming || typeof incoming !== 'object') return false
  const merged = mergeTrainingProgress(getTrainingProgress(), normalize(incoming))
  cached = merged
  persist()
  return true
}

/** 测试用：清空内存缓存 */
export function _resetProgressCacheForTest(): void {
  cached = null
}
