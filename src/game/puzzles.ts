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
import { boardFromFen, makeMove, coordToPos, isRed } from './board'
import { isInCheck, hasLegalMove, pieceToChinese } from './rules'
import { toRedScore, fenTurn } from './evalScore'

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

/** 测试辅助：注入题库（不触发网络/缓存） */
export function _setPuzzlesForTest(list: PuzzleItem[] | null): void {
  puzzles = list
  loadPromise = list ? Promise.resolve(true) : null
}

/** 按类型取题目（最多 n 题） */
export function getPuzzlesByType(type: PuzzleType, n = 50): PuzzleItem[] {
  if (!puzzles) return []
  return puzzles.filter(p => p.type === type).slice(0, n)
}

// ── 难度 / 任务类型（按局面事实判定，不盲信题库标签） ──────────────
//
// 历史问题：旧实现按 score_drop 分档，但题库全部来自"绝杀级"失误
// （600 题里 drop 最小 29700，其余为 0 或负值），于是 600 题一律判为「高级」，
// 难度筛选与自适应出题的难度阶梯形同虚设；且题库里 62 道标为「杀局」的题
// 实为行棋方已成败势的防守题，提示文案与局面相反。

export type PuzzleDifficulty = '初级' | '中级' | '高级'

/** 题目任务类型（按局面事实判定，可能与题库 type 标签不同） */
export type PuzzleTask = '杀王' | '防守' | '找最佳着'

/** 绝杀分阈值：题库用 ±30000，引擎用 ±(100000-N)，统一按 29000 判定 */
const MATE_SCORE = 29000

interface PuzzleFacts {
  /** 走出答案后对方立即被将死（一步杀） */
  mateIn1: boolean
  /** 赛前局面分（行棋方视角，正=行棋方占优） */
  moverScore: number
  /** 答案着法是否吃子 */
  isCapture: boolean
  /** 答案着法是否将军（含将死） */
  givesCheck: boolean
}

const factsCache = new Map<string, PuzzleFacts>()

/** 题目答案着法：杀局用实战着，其余用引擎最佳着（与重走判定口径一致） */
export function puzzleAnswer(p: PuzzleItem): string {
  return p.type === '杀局' ? p.move_uci : p.best_move
}

/** 题目唯一键（局面|答案），SRS 复习安排与进度统计用 */
export function puzzleKey(p: PuzzleItem): string {
  return `${p.fen.split(' ').slice(0, 2).join(' ')}|${puzzleAnswer(p)}`
}

function puzzleFacts(p: PuzzleItem): PuzzleFacts {
  // 缓存键含赛前分：同一 FEN+着法在数据里唯一，但测试/导入数据可能复用局面
  const key = `${p.fen}|${puzzleAnswer(p)}|${p.score_before ?? 0}`
  const hit = factsCache.get(key)
  if (hit) return hit
  let mateIn1 = false
  let moverScore = 0
  let isCapture = false
  let givesCheck = false
  try {
    const st = boardFromFen(p.fen)
    moverScore = toRedScore(p.score_before ?? 0, fenTurn(p.fen))
    const uci = puzzleAnswer(p)
    if (uci.length >= 4) {
      const to = coordToPos(uci.slice(2, 4))
      isCapture = st.board[to.col]?.[to.row] !== '.' && st.board[to.col]?.[to.row] !== undefined
      const next = makeMove(st, {
        from: coordToPos(uci.slice(0, 2)),
        to,
        turn: st.turn,
      })
      givesCheck = isInCheck(next)
      // 将死 = 对方被将军且无合法走法（提前退出扫描，批量分级才不至于卡主线程）
      mateIn1 = givesCheck && !hasLegalMove(next)
    }
  } catch { /* 数据异常时按最难处理 */ }
  const facts: PuzzleFacts = { mateIn1, moverScore, isCapture, givesCheck }
  factsCache.set(key, facts)
  return facts
}

/**
 * 分级提示 1：该动哪个子（答案着法的起点棋子）
 * 只给子力，不泄漏落点。
 */
export function puzzleHintPiece(p: PuzzleItem): string {
  try {
    const uci = puzzleAnswer(p)
    if (uci.length < 4) return ''
    const st = boardFromFen(p.fen)
    const from = coordToPos(uci.slice(0, 2))
    const piece = st.board[from.col]?.[from.row]
    if (!piece || piece === '.') return ''
    return pieceToChinese(piece, isRed(piece) ? 'w' : 'b')
  } catch { return '' }
}

/** 分级提示 2：这步棋的性质（吃子 / 将军 / 静着） */
export function puzzleHintNature(p: PuzzleItem): string {
  const f = puzzleFacts(p)
  if (f.isCapture && f.givesCheck) return '这是一步吃子并将军'
  if (f.isCapture) return '这是一步吃子'
  if (f.givesCheck) return '这是一步将军'
  return '这是一步静着（不吃子也不将军）'
}

/**
 * 题目难度（v1.22 改为按局面事实分档）：
 *   初级：一步杀（走出答案即绝杀）
 *   中级：已是必胜局面（赛前评估即绝杀分），需连续计算找出取胜着
 *   高级：其余局面（均势找最佳着 / 败势找最佳防守）
 */
export function puzzleDifficulty(p: PuzzleItem): PuzzleDifficulty {
  const f = puzzleFacts(p)
  if (f.mateIn1) return '初级'
  if (f.moverScore >= MATE_SCORE) return '中级'
  return '高级'
}

/**
 * 题目任务类型（按局面事实判定）。
 * 用于生成提示文案：题库里 62 道「杀局」实为行棋方已成败势的防守题，
 * 若直接按 type 提示"红方走出了杀着"，与局面正好相反。
 */
export function puzzleTask(p: PuzzleItem): PuzzleTask {
  const f = puzzleFacts(p)
  if (f.moverScore >= MATE_SCORE) return '杀王'
  if (f.moverScore <= -MATE_SCORE) return '防守'
  return '找最佳着'
}

/** 失误严重度文案：绝杀级分差不使用 cp 表述 */
export function puzzleDropText(p: PuzzleItem): string {
  const drop = p.score_drop ?? 0
  if (drop <= 0) return '实战着法即最佳着'
  if (drop >= MATE_SCORE) {
    return puzzleFacts(p).moverScore >= MATE_SCORE ? '错失绝杀' : '一步失误被绝杀'
  }
  const pawns = (drop / 100).toFixed(1)
  if (drop >= 500) return `严重失误，掉分约 ${pawns} 兵`
  if (drop >= 200) return `失误，掉分约 ${pawns} 兵`
  return `不够精确，掉分约 ${pawns} 兵`
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