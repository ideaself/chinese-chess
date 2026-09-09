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

export interface OpeningStat {
  attempts: number
  completed: boolean
  lastAt: number
}

export interface MistakeRetryStat {
  attempts: number
  right: number
  lastAt: number
  /** SRS：连续答对到第几级（答错归零） */
  stage?: number
  /** SRS：下次到期时间戳（0/缺省 = 立即可练） */
  dueAt?: number
}

/** 题目级复习安排（key: 局面|答案） */
export interface SrsStat {
  stage: number
  dueAt: number
  lastAt: number
}

/** SRS 间隔（天）：答对后逐级延长 */
export const SRS_INTERVALS_DAYS = [1, 3, 7, 21, 60]

const DAY_MS = 24 * 3600 * 1000
/** 答错后的重来间隔：10 分钟 */
const SRS_LAPSE_MS = 10 * 60 * 1000

/** 依据当前阶段与对错计算下次到期时间 */
export function nextDueAt(stage: number, correct: boolean, now = Date.now()): number {
  if (!correct) return now + SRS_LAPSE_MS
  // stage 1 对应第一个间隔（1 天），stage 2 → 3 天，依此类推
  const idx = Math.min(Math.max(stage - 1, 0), SRS_INTERVALS_DAYS.length - 1)
  const days = SRS_INTERVALS_DAYS[idx]
  return now + days * DAY_MS
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
    /** key: 题目（局面|答案）→ SRS 复习安排 */
    srs: Record<string, SrsStat>
  }
  /** key: 残局定式 id */
  endgames: Record<string, EndgameStat>
  /** key: 开局线路 id（book:... 或内置定式 id） */
  openings: Record<string, OpeningStat>
  /** key: 错题去重键（局面|着法） */
  mistakeRetries: Record<string, MistakeRetryStat>
}

function emptyProgress(): TrainingProgress {
  return {
    v: 1,
    puzzle: { byType: {}, byDiff: {}, streak: 0, streakDate: '', bestStreak: 0, dailyDone: {}, srs: {} },
    endgames: {},
    openings: {},
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
      srs: { ...(d.puzzle.srs ?? {}) },
    }
  }
  if (d.endgames && typeof d.endgames === 'object') out.endgames = { ...(d.endgames as TrainingProgress['endgames']) }
  if (d.openings && typeof d.openings === 'object') out.openings = { ...(d.openings as TrainingProgress['openings']) }
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

/**
 * 答题：更新题型/难度统计与连对；isDaily 时标记当日完成。
 * 传入 key（题目去重键）时同时更新该题的 SRS 复习安排。
 */
export function recordPuzzleAnswer(opts: {
  type?: string
  difficulty?: string
  correct: boolean
  isDaily?: boolean
  /** 题目键（局面|答案），用于 SRS */
  key?: string
}): void {
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
  if (opts.key) {
    const now = Date.now()
    const prev = q.srs[opts.key]
    const stage = opts.correct ? (prev?.stage ?? 0) + 1 : 0
    q.srs[opts.key] = { stage, dueAt: nextDueAt(stage, opts.correct, now), lastAt: now }
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

/** 开局训练：记一次开始（尝试次数） */
export function recordOpeningStart(lineId: string): void {
  const p = getTrainingProgress()
  const s = p.openings[lineId] ?? { attempts: 0, completed: false, lastAt: 0 }
  s.attempts++
  s.lastAt = Date.now()
  p.openings[lineId] = s
  persist()
}

/** 开局训练：走完整条定式（掌握） */
export function recordOpeningDone(lineId: string): void {
  const p = getTrainingProgress()
  const s = p.openings[lineId] ?? { attempts: 0, completed: false, lastAt: 0 }
  s.completed = true
  s.lastAt = Date.now()
  p.openings[lineId] = s
  persist()
}

export function recordMistakeRetry(key: string, correct: boolean): void {
  const p = getTrainingProgress()
  const s = p.mistakeRetries[key] ?? { attempts: 0, right: 0, lastAt: 0 }
  const now = Date.now()
  s.attempts++
  if (correct) s.right++
  s.lastAt = now
  // SRS：答对升一级，答错归零重排
  const stage = correct ? (s.stage ?? 0) + 1 : 0
  s.stage = stage
  s.dueAt = nextDueAt(stage, correct, now)
  p.mistakeRetries[key] = s
  persist()
}

/** 是否达到自动掌握标准（该错题累计答对 ≥2 次） */
export function isMistakeAutoMastered(key: string): boolean {
  const s = getTrainingProgress().mistakeRetries[key]
  return !!s && s.right >= 2
}

/**
 * 引擎追认：把刚记录的一次答错回滚为答对。
 *
 * 用于"殊途同归"——玩家走出的着法与引擎并列第一（题库/错题重走原先只认唯一 UCI，
 * 会把同等好着判错）。asked 净不变、right +1，连对按答对处理。
 */
export function amendPuzzleWrongToRight(opts: { type?: string; difficulty?: string; key?: string }): void {
  const q = getTrainingProgress().puzzle
  const dec = (s: TypeStat | undefined) => { if (s && s.asked > 0) s.asked-- }
  if (opts.type) dec(q.byType[opts.type])
  if (opts.difficulty) dec(q.byDiff[opts.difficulty])
  recordPuzzleAnswer({ type: opts.type, difficulty: opts.difficulty, correct: true, key: opts.key })
}

// ── SRS 查询 ──────────────────────────────────────────────────────

/** 题目现在可以练吗（从未练过视为可以） */
export function isPuzzleDue(key: string, now = Date.now()): boolean {
  const s = getTrainingProgress().puzzle.srs[key]
  return !s || s.dueAt <= now
}

/** 已练过且到期的题目键（最早到期优先；用于「今日复习」队列） */
export function duePuzzleKeys(now = Date.now(), n = 50): string[] {
  return Object.entries(getTrainingProgress().puzzle.srs)
    .filter(([, v]) => v.dueAt <= now)
    .sort((a, b) => a[1].dueAt - b[1].dueAt)
    .slice(0, n)
    .map(([k]) => k)
}

/** 到期待复习的错题键（从未练过的错题也计入） */
export function dueMistakeKeys(now = Date.now()): string[] {
  return Object.entries(getTrainingProgress().mistakeRetries)
    .filter(([, v]) => (v.dueAt ?? 0) <= now)
    .sort((a, b) => (a[1].dueAt ?? 0) - (b[1].dueAt ?? 0))
    .map(([k]) => k)
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
      srs: {},
    },
    endgames: {},
    openings: {},
    mistakeRetries: {},
  }
  const typeKeys = new Set([...Object.keys(current.puzzle.byType), ...Object.keys(incoming.puzzle.byType)])
  for (const k of typeKeys) out.puzzle.byType[k] = mergeStat(current.puzzle.byType[k], incoming.puzzle.byType[k])
  const diffKeys = new Set([...Object.keys(current.puzzle.byDiff), ...Object.keys(incoming.puzzle.byDiff)])
  for (const k of diffKeys) out.puzzle.byDiff[k] = mergeStat(current.puzzle.byDiff[k], incoming.puzzle.byDiff[k])
  // SRS 合并：阶段取较大（进度更靠前），到期取较早（更该复习），最近练习取较新
  const srsKeys = new Set([...Object.keys(current.puzzle.srs ?? {}), ...Object.keys(incoming.puzzle.srs ?? {})])
  for (const k of srsKeys) {
    const a = current.puzzle.srs?.[k]
    const b = incoming.puzzle.srs?.[k]
    if (!a) { out.puzzle.srs[k] = b!; continue }
    if (!b) { out.puzzle.srs[k] = a; continue }
    out.puzzle.srs[k] = {
      stage: Math.max(a.stage, b.stage),
      dueAt: Math.min(a.dueAt, b.dueAt),
      lastAt: Math.max(a.lastAt, b.lastAt),
    }
  }

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
  const opKeys = new Set([...Object.keys(current.openings), ...Object.keys(incoming.openings)])
  for (const k of opKeys) {
    const a = current.openings[k]
    const b = incoming.openings[k]
    out.openings[k] = {
      attempts: Math.max(a?.attempts ?? 0, b?.attempts ?? 0),
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
      stage: Math.max(a?.stage ?? 0, b?.stage ?? 0),
      // 到期取较早（更该复习）；两侧都没排期时保持 0（视为立即可练）
      dueAt: Math.min(a?.dueAt ?? 0, b?.dueAt ?? 0),
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
