/**
 * 精选题库 - 实战题目数据（public/puzzles-v2.json）
 *
 * 三类题目，来自 141k 局大师棋谱 + Pikafish 分析:
 *   - 杀局: 局面已是必胜/绝杀，实战走出了引擎认可的最佳着（找杀着）
 *   - 失误题: 实战严重失误（掉分 ≥300cp），找引擎最佳着
 *   - 残局题: 残局阶段失误，找最佳着
 */

import {
  getPuzzleStreak as progressGetPuzzleStreak,
  recordPuzzleAnswer,
} from './progress'

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
  return difficultyFromDrop(p.type, p.score_drop ?? 0)
}

/** 由题型与掉分推导难度（题库题与复盘重走共用） */
export function difficultyFromDrop(type: string, drop: number): '初级' | '中级' | '高级' {
  if (type === '杀局') return '高级'
  if (drop >= 500) return '高级'
  if (drop >= 200) return '中级'
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

/** 连对 streak（v1.21 起由 progress.ts 统一存储，此处保留原 API） */
export function getPuzzleStreak(): { count: number; todayDone: boolean } {
  return progressGetPuzzleStreak()
}

/** 答对：count+1（同日去重）；答错：清零 */
export function recordPuzzleCorrect(): void {
  recordPuzzleAnswer({ correct: true })
}

export function recordPuzzleWrong(): void {
  recordPuzzleAnswer({ correct: false })
}