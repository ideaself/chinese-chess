/**
 * 精选题库 - 实战题目数据（public/puzzles-v2.json）
 *
 * 三类题目，来自 141k 局大师棋谱 + Pikafish 分析:
 *   - 杀局: 局面已是必胜/绝杀，实战走出了引擎认可的最佳着（找杀着）
 *   - 失误题: 实战严重失误（掉分 ≥300cp），找引擎最佳着
 *   - 残局题: 残局阶段失误，找最佳着
 */

export interface PuzzleItem {
  type: '杀局' | '失误题' | '残局题'
  game_id: number
  ply: number
  fen: string
  move_uci: string
  best_move: string
  score_before: number
  score_drop: number
  result: string
  event: string
  red: string
  black: string
}

export const PUZZLE_TYPES = ['杀局', '失误题', '残局题'] as const
export type PuzzleType = (typeof PUZZLE_TYPES)[number]

let puzzles: PuzzleItem[] | null = null
let loadPromise: Promise<boolean> | null = null

const CACHE_KEY = 'xiangqi-puzzles-v2'
const CACHE_TTL = 7 * 24 * 3600 * 1000 // 7d

/** 拉取题库（幂等，失败可重试；已缓存则直接用） */
export function loadPuzzles(): Promise<boolean> {
  if (!loadPromise) {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        if (d && Array.isArray(d)) {
          puzzles = d
          loadPromise = Promise.resolve(true)
          return loadPromise
        }
      }
    } catch { /* 忽略 */ }
    loadPromise = fetch('puzzles-v2.json')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: PuzzleItem[]) => {
        if (Array.isArray(data) && data.length > 0) {
          puzzles = data
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)) } catch { /* 忽略 */ }
          return true
        }
        return false
      })
      .catch(e => {
        console.warn('题库加载失败:', e)
        loadPromise = null
        return false
      })
  }
  return loadPromise
}

export function getPuzzles(): PuzzleItem[] | null {
  return puzzles
}

/** 按类型取题目（最多 n 题） */
export function getPuzzlesByType(type: PuzzleType, n = 50): PuzzleItem[] {
  if (!puzzles) return []
  return puzzles.filter(p => p.type === type).slice(0, n)
}

/** 题目难度分级（基于掉分/杀棋） */
export function puzzleDifficulty(p: PuzzleItem): '初级' | '中级' | '高级' {
  if (p.type === '杀局') return '高级'
  if (p.score_drop >= 500) return '高级'
  if (p.score_drop >= 200) return '中级'
  return '初级'
}

/** 每日挑战：按日期种子从指定类型取固定一题 */
export function getDailyPuzzle(type: PuzzleType): PuzzleItem | null {
  if (!puzzles) return null
  const pool = puzzles.filter(p => p.type === type)
  if (pool.length === 0) return null
  const today = new Date()
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()
  return pool[seed % pool.length]
}

/** 连对 streak 持久化（localStorage） */
const STREAK_KEY = 'xiangqi-puzzle-streak'
const STREAK_DATE_KEY = 'xiangqi-puzzle-streak-date'

export function getPuzzleStreak(): { count: number; todayDone: boolean } {
  try {
    const count = parseInt(localStorage.getItem(STREAK_KEY) || '0', 10) || 0
    const date = localStorage.getItem(STREAK_DATE_KEY) || ''
    const today = new Date().toDateString()
    return { count, todayDone: date === today && count > 0 }
  } catch {
    return { count: 0, todayDone: false }
  }
}

/** 答对：count+1（同日去重）；答错：清零 */
export function recordPuzzleCorrect(): void {
  try {
    const { count, todayDone } = getPuzzleStreak()
    if (todayDone) return
    localStorage.setItem(STREAK_KEY, String(count + 1))
    localStorage.setItem(STREAK_DATE_KEY, new Date().toDateString())
  } catch { /* 忽略 */ }
}

export function recordPuzzleWrong(): void {
  try {
    localStorage.setItem(STREAK_KEY, '0')
  } catch { /* 忽略 */ }
}