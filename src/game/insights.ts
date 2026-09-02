/**
 * 数据洞察 - 大师棋谱统计分析（public/chess-insights.json）
 *
 * 141k 局棋谱 + Pikafish depth 8/12 分析聚合:
 *   - 开局体系: 局数 / 红方得分率 / 失误率
 *   - 棋手: 失误率排行（低失误 = 更稳健）
 *   - 赛事: 失误率
 *   - 失误集锦: 精选严重失误（点击可进入题目训练）
 */

export interface OpeningStat {
  system: string
  n: number
  redScore: number
  mistakeRate: number
}

export interface PlayerStat {
  name: string
  moves: number
  mistakeRate: number
  blunderRate: number
}

export interface EventStat {
  event: string
  games: number
  mistakeRate: number
}

export interface MistakeCollection {
  fen: string
  move: string
  best: string
  drop: number
  ply: number
  mover: string
  red: string
  black: string
  event: string
  result: string
}

export interface InsightsData {
  generatedAt: string
  source: string
  stats: {
    games: number
    openings: OpeningStat[]
    players: PlayerStat[]
    events: EventStat[]
  }
  mistakeCollection: MistakeCollection[]
}

let insights: InsightsData | null = null
let loadPromise: Promise<boolean> | null = null

const CACHE_KEY = 'xiangqi-insights-v1'
const CACHE_TTL = 24 * 3600 * 1000 // 24h

function readCache(): InsightsData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (Date.now() - (d.generatedAt ? Date.parse(d.generatedAt) || 0 : 0) > CACHE_TTL) return null
    return d
  } catch {
    return null
  }
}

function writeCache(d: InsightsData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(d))
  } catch { /* 忽略 */ }
}

export function loadInsights(): Promise<boolean> {
  if (!loadPromise) {
    const cached = readCache()
    if (cached) {
      insights = cached
      loadPromise = Promise.resolve(true)
    } else {
      loadPromise = fetch('chess-insights.json')
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data: InsightsData) => {
          if (data && data.stats && Array.isArray(data.mistakeCollection)) {
            insights = data
            writeCache(data)
            return true
          }
          return false
        })
        .catch(e => {
          console.warn('洞察数据加载失败:', e)
          loadPromise = null
          return false
        })
    }
  }
  return loadPromise
}

export function getInsights(): InsightsData | null {
  return insights
}