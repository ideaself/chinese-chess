/**
 * 大师棋谱库
 *
 * 加载 public/master-games.json（由 scripts/dpxq-convert.mjs 生成），
 * 提供开局体系分类、残局标记、按需转换为完整 Game。
 *
 * 分类方法（基于前几步着法模式，无需引擎）:
 *   红方布局: 中炮 / 飞相局 / 仙人指路 / 起马局 / 过宫炮 / 士角炮
 *   黑方应法(中炮局): 屏风马 / 顺炮 / 列炮 / 反宫马
 */

import type { Game } from './model'
import type { MasterRecord } from './dhtmlxq'
import { buildGameFromRecord } from './dhtmlxq'

// ── 数据加载（分片懒加载） ────────────────────────────────────────

export interface LibraryManifest {
  generatedAt: string
  source: string
  total: number
  /** 收录棋谱的最大 dpxq gameid（打开上限，v1.21 起随全量语料） */
  maxId?: number
  shardSize: number
  shards: string[]
  /** 各分片收录的 id 范围 [lo, hi]（分片按 id 升序切分，供定点取局） */
  ranges?: [number, number][]
}

let cachePromise: Promise<void> | null = null
let cacheGames: LibraryGame[] | null = null
let manifest: LibraryManifest | null = null
let loadedShards = 0

/** 轻量拉取 manifest（不加载任何分片）；用于打开上限与定点索引 */
let manifestPromise: Promise<LibraryManifest | null> | null = null

export function ensureManifest(): Promise<LibraryManifest | null> {
  if (manifest) return Promise.resolve(manifest)
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const m = await fetch('master-games/manifest.json')
        if (!m.ok) return null
        manifest = (await m.json()) as LibraryManifest
        return manifest
      } catch {
        return null
      }
    })()
  }
  return manifestPromise
}

/** 可打开的最大 gameid；manifest 未加载时返回 null（调用方用旧上限兜底） */
export function getOpenableMaxId(): number | null {
  return manifest?.maxId ?? null
}

/** 确保打开上限可用（轻量，只拉 manifest）；返回 maxId 或 null */
export async function ensureOpenableMaxId(): Promise<number | null> {
  const m = await ensureManifest()
  return m?.maxId ?? null
}

/** 加载棋谱库：manifest + 全部分片并行请求（模块级缓存，只请求一次） */
export function loadLibrary(): Promise<void> {
  if (!cachePromise) {
    cachePromise = (async () => {
      const mf = await ensureManifest()
      if (!mf) throw new Error('manifest 加载失败')
      // 并行拉取全部分片，按分片顺序合并（浏览器对同源并发自动排队）
      const shardGames = await Promise.all(mf.shards.map(async name => {
        const res = await fetch(`master-games/${name}`)
        if (!res.ok) throw new Error(`分片 ${name} 加载失败 (HTTP ${res.status})`)
        return (await res.json()) as MasterRecord[]
      }))
      cacheGames = shardGames.flat().map(g => ({ ...g, cls: classifyRecord(g) }))
      loadedShards = mf.shards.length
    })()
  }
  return cachePromise
}

/** 加载前 N 个分片（全量库大时列表页首屏用；后续可用 loadMoreGames 续载） */
export async function loadLibraryPrefix(n: number): Promise<void> {
  const mf = await ensureManifest()
  if (!mf) throw new Error('manifest 加载失败')
  if (cacheGames && loadedShards > 0) return // 已有进度，续载交给 loadMoreGames
  cacheGames = []
  const take = mf.shards.slice(0, Math.max(1, Math.min(n, mf.shards.length)))
  const shardGames = await Promise.all(take.map(async name => {
    const res = await fetch(`master-games/${name}`)
    if (!res.ok) throw new Error(`分片 ${name} 加载失败 (HTTP ${res.status})`)
    return (await res.json()) as MasterRecord[]
  }))
  cacheGames = shardGames.flat().map(g => ({ ...g, cls: classifyRecord(g) }))
  loadedShards = take.length
}

/** 定点取局缓存（按 id 打开单局用；LRU 上限，防内存膨胀） */
const shardForIdCache = new Map<number, MasterRecord[]>()
const SHARD_CACHE_MAX = 12

function shardIndexForId(mf: LibraryManifest, id: number): number {
  if (mf.ranges && mf.ranges.length === mf.shards.length) {
    // 分片按 id 升序且范围不重叠 → 二分
    let lo = 0, hi = mf.ranges.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [rlo, rhi] = mf.ranges[mid]
      if (id < rlo) hi = mid - 1
      else if (id > rhi) lo = mid + 1
      else return mid
    }
    return -1
  }
  // 无 ranges（旧 manifest）：按序号估算 + 邻域扫描兜底
  const guess = Math.min(mf.shards.length - 1, Math.max(0, Math.floor((id - 1) / mf.shardSize)))
  return guess
}

/**
 * 按 dpxq gameid 定点取一条记录（只拉所在分片，不全量加载）。
 * 找不到返回 null。供相似局面「打开对局」等场景，替代全量 loadLibrary。
 */
export async function fetchGameById(id: number): Promise<MasterRecord | null> {
  const mf = await ensureManifest()
  if (!mf) return null
  let idx = shardIndexForId(mf, id)
  if (idx < 0) return null
  const tryLoad = async (i: number): Promise<MasterRecord[] | null> => {
    if (shardForIdCache.has(i)) return shardForIdCache.get(i)!
    const name = mf.shards[i]
    if (!name) return null
    const res = await fetch(`master-games/${name}`)
    if (!res.ok) return null
    const recs = (await res.json()) as MasterRecord[]
    shardForIdCache.set(i, recs)
    // 简易 LRU：超上限删最旧
    if (shardForIdCache.size > SHARD_CACHE_MAX) {
      const first = shardForIdCache.keys().next().value
      if (first !== undefined) shardForIdCache.delete(first)
    }
    return recs
  }
  // 命中范围优先；无 ranges 估算失配时向两侧各扫一个分片
  const candidates = mf.ranges ? [idx] : [idx, idx - 1, idx + 1]
  for (const i of candidates) {
    if (i < 0 || i >= mf.shards.length) continue
    const recs = await tryLoad(i)
    const hit = recs?.find(r => r.id === id)
    if (hit) return hit
  }
  return null
}

async function loadShard(i: number): Promise<void> {
  const name = manifest?.shards[i]
  if (!name) return
  const res = await fetch(`master-games/${name}`)
  if (!res.ok) throw new Error(`分片 ${name} 加载失败 (HTTP ${res.status})`)
  const games = (await res.json()) as MasterRecord[]
  cacheGames!.push(...games.map(g => ({ ...g, cls: classifyRecord(g) })))
  loadedShards++
}

/** 加载下一分片；返回是否还有更多 */
export async function loadMoreGames(): Promise<boolean> {
  if (!manifest || loadedShards >= manifest.shards.length) return false
  await loadShard(loadedShards)
  return loadedShards < manifest.shards.length
}

/** 是否还有未加载的分片 */
export function hasMoreGames(): boolean {
  return !!manifest && loadedShards < manifest.shards.length
}

/** 库概况（未加载时返回 null） */
export function getLibraryInfo(): { total: number; loaded: number; source: string } | null {
  if (!manifest) return null
  return { total: manifest.total, loaded: cacheGames?.length ?? 0, source: manifest.source }
}

/** 同步获取已分类的棋谱（尚未加载时返回 null） */
export function getCachedLibrary(): LibraryGame[] | null {
  return cacheGames
}

// ── 开局分类 ──────────────────────────────────────────────────────

export type OpeningFamily =
  | 'zhongpao'  // 中炮
  | 'feixiang'  // 飞相局
  | 'xianren'   // 仙人指路
  | 'qima'      // 起马局
  | 'guogong'   // 过宫炮
  | 'shijiao'   // 士角炮
  | 'other'

export type BlackDefense =
  | 'pingfengma' // 屏风马
  | 'shunpao'    // 顺炮
  | 'liepao'     // 列炮
  | 'fangongma'  // 反宫马

export const FAMILY_INFO: Record<OpeningFamily, { name: string; desc: string }> = {
  zhongpao: { name: '中炮', desc: '当头炮直攻中路，最主流的进攻体系' },
  feixiang: { name: '飞相局', desc: '以静制动，先固防后反击' },
  xianren: { name: '仙人指路', desc: '挺兵试探弹性布局，变化繁多' },
  qima: { name: '起马局', desc: '抢先活马，稳步展开' },
  guogong: { name: '过宫炮', desc: '炮过宫角集结子力，阵型厚实' },
  shijiao: { name: '士角炮', desc: '炮镇士角，攻守兼备' },
  other: { name: '其他布局', desc: '少见或冷门的首着' },
}

export const DEFENSE_INFO: Record<BlackDefense, { name: string; desc: string }> = {
  pingfengma: { name: '屏风马', desc: '双马护中卒如屏风，最稳健的后手体系' },
  shunpao: { name: '顺炮', desc: '同方向架中炮硬刚，对攻激烈' },
  liepao: { name: '列炮', desc: '反方向架中炮，两翼对攻' },
  fangongma: { name: '反宫马', desc: '屏风马加士角炮，弹性防守' },
}

export interface Classification {
  family: OpeningFamily
  /** 仅中炮类有值 */
  defense?: BlackDefense
  /** 残局阶段丰富（实战残局教学价值高） */
  endgame: boolean
}

export interface LibraryGame extends MasterRecord {
  cls: Classification
}

/** 残局标签阈值：黑方行棋后子力 ≤11 的回合数 */
const ENDGAME_PLIES_THRESHOLD = 15

/**
 * 按首着分类红方布局
 */
function classifyFamily(firstMove: string): OpeningFamily {
  if (firstMove === 'h2e2' || firstMove === 'b2e2') return 'zhongpao'
  if (firstMove === 'c0e2' || firstMove === 'c2e0') return 'feixiang'
  if (firstMove === 'c3c4' || firstMove === 'g3g4') return 'xianren'
  if (firstMove === 'b0c2' || firstMove === 'h0g2') return 'qima'
  if (firstMove === 'h2d2' || firstMove === 'b2f2') return 'guogong'
  if (firstMove === 'h2f2' || firstMove === 'b2d2') return 'shijiao'
  return 'other'
}

interface UciPos { col: number; row: number }

function posOf(uci: string, offset: number): UciPos {
  return { col: uci.charCodeAt(offset) - 97, row: parseInt(uci[offset + 1]) }
}

/**
 * 黑方应法识别（扫描前 12 回合内的黑方着法）
 *
 * 坐标事实:
 *   黑炮起始位: (1,7) 与 (7,7)
 *   黑马起始位: (1,9) 与 (7,9)
 *   马2进3 → (2,7)，马8进7 → (6,7) 即双正马=屏风马形态
 *   炮落 (4,7) 为架中炮: 从 (7,7) 来是顺炮，从 (1,7) 来是列炮
 *   炮落 (3,7)/(5,7) 为士角炮（配合双正马即反宫马）
 */
function classifyDefense(mv: string): BlackDefense | undefined {
  let centerFromCol: number | null = null // 架中炮的炮起点列
  let horseLeft = false  // (2,7) 有正马
  let horseRight = false // (6,7) 有正马
  let cornerCannon = false

  const plies = Math.min(Math.floor(mv.length / 4), 24)
  for (let i = 1; i < plies; i += 2) {
    const uci = mv.slice(i * 4, i * 4 + 4)
    if (uci.length < 4) break
    const from = posOf(uci, 0)
    const to = posOf(uci, 2)

    // 黑炮出动
    if ((from.col === 1 || from.col === 7) && from.row === 7) {
      if (to.row === 7 && to.col === 4 && centerFromCol === null) centerFromCol = from.col
      else if (to.row === 7 && (to.col === 3 || to.col === 5)) cornerCannon = true
    }
    // 黑马出动（双正马）
    if (from.row === 9 && (from.col === 1 || from.col === 7)) {
      if (to.col === 2 && to.row === 7) horseLeft = true
      if (to.col === 6 && to.row === 7) horseRight = true
    }
  }

  if (centerFromCol === 7) return 'shunpao'
  if (centerFromCol === 1) return 'liepao'
  if (horseLeft && horseRight) return cornerCannon ? 'fangongma' : 'pingfengma'
  return undefined
}

/** 对单条记录分类 */
export function classifyRecord(rec: MasterRecord): Classification {
  const family = rec.mv.length >= 4 ? classifyFamily(rec.mv.slice(0, 4)) : 'other'
  const defense = family === 'zhongpao'
    ? (rec.mv.length >= 8 ? classifyDefense(rec.mv) : undefined)
    : undefined
  const endgame = ((rec as { eg?: number }).eg ?? 0) >= ENDGAME_PLIES_THRESHOLD
  return { family, defense, endgame }
}

/** 批量分类并附加到记录 */
export function classifyLibrary(games: MasterRecord[]): LibraryGame[] {
  return games.map(g => ({ ...g, cls: classifyRecord(g) }))
}

/** 记录 → 完整 Game（逐步验证 + 中文记谱），失败返回 null */
export function recordToGame(rec: LibraryGame): Game | null {
  const r = buildGameFromRecord(rec)
  return r.success ? r.game ?? null : null
}

/** 记录显示标题 */
export function recordTitle(rec: LibraryGame): string {
  if (rec.t) return rec.t
  return `${rec.r || '红方'} vs ${rec.b || '黑方'}`
}

// ── 棋手索引 ──────────────────────────────────────────────────────

/** "广东 许银川" → "许银川"（取最后一段，兼容无地区前缀写法） */
function bareName(raw: string): string {
  const parts = raw.trim().split(/\s+/)
  return parts[parts.length - 1] || raw.trim()
}

export interface PlayerEntry {
  name: string
  count: number
}

/** 从已加载对局统计棋手出场对局数（红黑方合并），按局数降序 */
export function aggregatePlayers(games: LibraryGame[]): PlayerEntry[] {
  const counts = new Map<string, number>()
  const bump = (raw?: string) => {
    if (!raw) return
    const name = bareName(raw)
    if (!name || name === '未知' || name === '?' || name === '-') return
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  for (const g of games) { bump(g.r); bump(g.b) }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
}

/** 对局是否为指定棋手参与（子串匹配红/黑方原始字段） */
export function gameHasPlayer(g: LibraryGame, name: string): boolean {
  return (g.r || '').includes(name) || (g.b || '').includes(name)
}

/** 棋手页聚合：总对局、执红/执黑胜负、常用开局（爱棋谱式棋手库） */
export interface PlayerProfile {
  name: string
  total: number
  asRed: OpeningStats
  asBlack: OpeningStats
  topOpenings: { name: string; count: number }[]
}
export function aggregatePlayerProfile(games: LibraryGame[], name: string): PlayerProfile {
  const asRed: OpeningStats = { total: 0, redWin: 0, blackWin: 0, draw: 0 }
  const asBlack: OpeningStats = { total: 0, redWin: 0, blackWin: 0, draw: 0 }
  const famCount = new Map<OpeningFamily, number>()
  for (const g of games) {
    const isRed = (g.r || '').includes(name)
    const isBlack = (g.b || '').includes(name)
    if (!isRed && !isBlack) continue
    const stat = isRed ? asRed : asBlack
    stat.total++
    if (g.res === '红胜') stat.redWin++
    else if (g.res === '黑胜') stat.blackWin++
    else stat.draw++
    if (g.cls.family) famCount.set(g.cls.family, (famCount.get(g.cls.family) || 0) + 1)
  }
  const topOpenings = [...famCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([f, count]) => ({ name: FAMILY_INFO[f]?.name ?? f, count }))
  return { name, total: asRed.total + asBlack.total, asRed, asBlack, topOpenings }
}

// ── 开局胜率统计 ──────────────────────────────────────────────────

export interface OpeningStats {
  total: number
  redWin: number
  blackWin: number
  draw: number
}

export type StatsKey = string // family 或 family|defense

/** 按开局体系（含中炮局黑方应法细分）聚合胜负率 */
export function aggregateOpeningStats(games: LibraryGame[]): Map<StatsKey, OpeningStats> {
  const map = new Map<StatsKey, OpeningStats>()
  const bump = (key: StatsKey, res?: string) => {
    let s = map.get(key)
    if (!s) { s = { total: 0, redWin: 0, blackWin: 0, draw: 0 }; map.set(key, s) }
    s.total++
    if (res === '红胜') s.redWin++
    else if (res === '黑胜') s.blackWin++
    else if (res === '和棋' || res === '和局') s.draw++
  }
  for (const g of games) {
    bump(g.cls.family, g.res)
    if (g.cls.defense) bump(`${g.cls.family}|${g.cls.defense}`, g.res)
  }
  return map
}

/** 格式化为 "红42% 和31% 黑27%" */
export function formatStats(s: OpeningStats): string {
  const pct = (n: number) => Math.round((n / s.total) * 100)
  return `红${pct(s.redWin)}% · 和${pct(s.draw)}% · 黑${pct(s.blackWin)}%`
}
