/**
 * 开局库
 *
 * 两层数据:
 *   1. 大数据开局书 public/opening-book.json（scripts/book-gen.mjs 从 dpxq 语料聚合，
 *      每个局面保留行棋方视角最优的主流着法，附出现次数与红方得分率）
 *   2. 内置小型定式表（离线兜底，覆盖常见首着）
 *
 * 查询按行棋方视角过滤得分率过低着法后，按实战频率加权随机，
 * 兼顾开局强度与多样性；超出库范围交由引擎搜索。
 */

export interface BookCandidate {
  /** UCI 着法 */
  m: string
  /** 实战出现次数 */
  n: number
  /** 红方视角得分率 (红胜+0.5×和)/n */
  wr: number
}

interface BookData {
  generatedAt?: string
  games?: number
  maxPly?: number
  positions: Record<string, BookCandidate[]>
}

/** 行棋方可接受的最低得分率（避免选到明显吃亏的着法） */
const MIN_MOVER_SCORE = 0.45

// ── 内置兜底定式（开局书未加载时使用） ───────────────────────────

const BUILTIN_BOOK: Record<string, string[]> = {
  '': ['h2e2', 'c3c4', 'c0e2', 'h0g2'],
  'h2e2': ['b9c7', 'h9g7', 'h7e7'],
  'c0e2': ['h9g7', 'c6c5'],
  'c3c4': ['b7e7', 'c6c5'],
  'h0g2': ['b9c7', 'h9g7'],
  'h2e2 b9c7': ['h0g2', 'b0c2'],
  'h2e2 h7e7': ['h0g2', 'b0c2'],
}

const builtinCandidates: Record<string, BookCandidate[]> = Object.fromEntries(
  Object.entries(BUILTIN_BOOK).map(([k, arr]) => [k, arr.map(m => ({ m, n: 1000, wr: 0.5 }))]),
)

// ── 大数据开局书加载 ──────────────────────────────────────────────

let bigBook: BookData | null = null
let loadPromise: Promise<boolean> | null = null

/** 拉取大数据开局书（幂等，失败返回 false 且可重试） */
export function loadOpeningBook(): Promise<boolean> {
  if (!loadPromise) {
    loadPromise = fetch('opening-book.json')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: BookData) => {
        if (data && typeof data.positions === 'object') {
          bigBook = data
          return true
        }
        return false
      })
      .catch(e => {
        console.warn('开局书加载失败，使用内置定式:', e)
        loadPromise = null // 允许重试
        return false
      })
  }
  return loadPromise
}

export function isBookLoaded(): boolean {
  return bigBook !== null
}

// ── 查询 ──────────────────────────────────────────────────────────

/**
 * 查询开局库
 * @param moves 已走着法（UCI 数组）
 * @returns 加权随机候选着法，或 null（不在库中）
 */
export function getBookMove(moves: string[]): string | null {
  const table = bigBook?.positions ?? builtinCandidates
  if (bigBook && moves.length >= (bigBook.maxPly ?? 10)) return null

  const candidates = table[moves.join(' ')]
  if (!candidates || candidates.length === 0) return null

  const redToMove = moves.length % 2 === 0

  // 行棋方视角过滤（带浮点容差）+ 按频率加权随机
  const usable = candidates.filter(c =>
    builtinHas(table, moves.join(' '), c) ||
      (redToMove ? c.wr : 1 - c.wr) >= MIN_MOVER_SCORE - 1e-9,
  )
  const pool = usable.length > 0 ? usable : [candidates[0]]

  const totalWeight = pool.reduce((s, c) => s + Math.sqrt(Math.max(1, c.n)), 0)
  let roll = Math.random() * totalWeight
  for (const c of pool) {
    roll -= Math.sqrt(Math.max(1, c.n))
    if (roll <= 0) return c.m
  }
  return pool[pool.length - 1].m
}

function builtinHas(table: Record<string, BookCandidate[]>, key: string, c: BookCandidate): boolean {
  return table === builtinCandidates && builtinCandidates[key]?.some(x => x.m === c.m)
}

/** 测试辅助：注入数据 */
export function _setBookDataForTest(data: BookData | null): void {
  bigBook = data
  loadPromise = data ? Promise.resolve(true) : null
}
