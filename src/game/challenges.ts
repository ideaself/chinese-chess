/**
 * 天天象棋残局挑战（东萍象棋网友上传的历史存档）
 *
 * 数据: public/weekly-challenges.json，由 scripts/weekly-challenges.mjs 抓取生成
 * 进度: 通关期号存 localStorage（与训练进度一样属于本地轻量数据）
 */
export interface WeeklyChallenge {
  n: number
  date: string
  title: string
  fen: string
}

let cache: WeeklyChallenge[] | null = null
let loadPromise: Promise<WeeklyChallenge[]> | null = null

/** 拉取题库（幂等，失败可重试） */
export function loadChallenges(): Promise<WeeklyChallenge[]> {
  if (cache) return Promise.resolve(cache)
  if (!loadPromise) {
    loadPromise = fetch('weekly-challenges.json')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { items?: WeeklyChallenge[] }) => {
        cache = (data.items ?? []).slice().sort((a, b) => a.n - b.n)
        return cache
      })
      .catch(e => {
        loadPromise = null // 允许重试
        throw e
      })
  }
  return loadPromise
}

export function getChallenges(): WeeklyChallenge[] {
  return cache ?? []
}

export function getChallenge(n: number): WeeklyChallenge | null {
  return (cache ?? []).find(c => c.n === n) ?? null
}

/** 下一期（按现有存档顺序，不要求期号连续） */
export function getNextChallenge(n: number): WeeklyChallenge | null {
  return (cache ?? []).find(c => c.n > n) ?? null
}

const CLEARED_KEY = 'xiangqi-challenge-cleared'

/** 已通关期号集合 */
export function getClearedChallenges(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : [])
  } catch {
    return new Set()
  }
}

/** 记录一期通关/失败（失败不覆盖已有通关记录） */
export function recordChallengeCleared(n: number, cleared: boolean): void {
  if (!n) return
  try {
    const set = getClearedChallenges()
    if (cleared) set.add(n)
    else if (set.has(n)) return
    localStorage.setItem(CLEARED_KEY, JSON.stringify([...set].sort((a, b) => a - b)))
  } catch {
    // 存储不可用时忽略
  }
}
