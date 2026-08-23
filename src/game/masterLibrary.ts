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

// ── 数据加载 ──────────────────────────────────────────────────────

export interface LibraryPayload {
  generatedAt: string
  source: string
  count: number
  games: MasterRecord[]
}

let cachePromise: Promise<LibraryPayload> | null = null

/** 懒加载棋谱库（模块级缓存，只请求一次） */
export function loadLibrary(): Promise<LibraryPayload> {
  if (!cachePromise) {
    cachePromise = fetch('master-games.json').then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<LibraryPayload>
    })
  }
  return cachePromise
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
