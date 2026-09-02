/**
 * 大师参考 - 相似局面检索（public/similar/ 索引）
 *
 * 141k 局棋谱按 UCI 前缀索引：给定当前着法序列，
 * 返回大师们在此局面的所有着法及对应对局（可跳转复盘）。
 */

export interface SimilarEntry {
  move: string
  gameIds: number[]
}

export interface GameMeta {
  t: string
  r: string
  b: string
  e: string
  res: string
}

interface IndexShard {
  firstMove: string
  depth: number
  index: Record<string, Record<string, number[]>>
}

/** master-games 分片覆盖的最大 gameid（超过只能看标题不能打开） */
export const OPENABLE_MAX_ID = 50000
const META_SHARD_SIZE = 20000

const shardCache = new Map<string, IndexShard>()
const metaCache = new Map<number, GameMeta>()
let metaLoading = new Set<string>()

function shardName(firstMove: string): string {
  return firstMove && /^[a-z0-9]+$/i.test(firstMove) ? firstMove : 'other'
}

function metaFileName(gameId: number): string {
  const lo = Math.floor((gameId - 1) / META_SHARD_SIZE) * META_SHARD_SIZE + 1
  const hi = lo + META_SHARD_SIZE - 1
  return `meta_${String(lo).padStart(6, '0')}-${String(hi).padStart(6, '0')}.json`
}

/** 加载某首着对应的索引分片（幂等） */
export async function loadSimilarShard(firstMove: string): Promise<boolean> {
  const name = shardName(firstMove)
  if (shardCache.has(name)) return true
  try {
    const res = await fetch(`similar/index_${name}.json`)
    if (!res.ok) return false
    const data: IndexShard = await res.json()
    shardCache.set(name, data)
    return true
  } catch {
    return false
  }
}

/** 确保指定对局 id 的 meta 已加载 */
export async function loadMetaFor(gameIds: number[]): Promise<void> {
  const needed = new Set(gameIds.filter(id => id > 0).map(metaFileName))
  for (const file of needed) {
    if (metaLoading.has(file)) continue
    metaLoading.add(file)
    try {
      const res = await fetch(`similar/${file}`)
      if (!res.ok) continue
      const data: { meta: Record<string, GameMeta> } = await res.json()
      for (const [k, v] of Object.entries(data.meta)) {
        metaCache.set(parseInt(k), v)
      }
    } catch { /* 静默 */ }
  }
}

/**
 * 查询当前局面的大师着法
 * @param moves 已走着法 UCI 序列（≤6 步）
 * @returns 大师着法列表（含对局 id），未命中返回 null
 */
export function querySimilar(moves: string[]): SimilarEntry[] | null {
  if (moves.length === 0 || moves.length > 6) return null
  const first = moves[0]
  const shard = shardCache.get(shardName(first))
  if (!shard) return null
  const bucket = shard.index[moves.join(' ')]
  if (!bucket) return null
  return Object.entries(bucket)
    .map(([move, gameIds]) => ({ move, gameIds }))
    .sort((a, b) => b.gameIds.length - a.gameIds.length)
}

/** 着法红方得分率（红胜 + 0.5×和）/n；meta 未加载的局不计入 */
export function moveScore(entry: SimilarEntry): { n: number; redScore: number } {
  let n = 0
  let redScore = 0
  for (const id of entry.gameIds) {
    const m = metaCache.get(id)
    if (!m) continue
    n++
    if (m.res === '1-0') redScore += 1
    else if (m.res === '1/2-1/2') redScore += 0.5
  }
  return { n, redScore: n ? redScore / n : 0 }
}

export function gameMeta(gameId: number): GameMeta | undefined {
  return metaCache.get(gameId)
}

export function canOpenGame(gameId: number): boolean {
  return gameId <= OPENABLE_MAX_ID
}

/** 测试辅助 */
export function _clearSimilarCache(): void {
  shardCache.clear()
  metaCache.clear()
}