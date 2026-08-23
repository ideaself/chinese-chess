/**
 * DhtmlXQ（东萍象棋网 dpxq.com）棋谱格式解析
 *
 * 源文件为 [DhtmlXQ]...[/DhtmlXQ] 标签块，核心字段:
 *   [DhtmlXQ_movelist]77477062...[/DhtmlXQ_movelist]
 *
 * movelist 编码: 每 4 个数字一步 "x1y1x2y2"
 *   x = 列 0-8（从左到右，红下黑上视角）
 *   y = 行 0-9（从上到下）
 * 转换为本应用 UCI (a-i, 0-9 红方在下):
 *   col = x, row = 9 - y
 */

import type { Game, GameHeader } from './model'
import { createEmptyGame, addPlyToGame } from './model'
import { boardFromFen, START_FEN } from './board'
import { getLegalMoves } from './rules'

export interface DpxqParseResult {
  success: boolean
  game?: Game
  error?: string
  errorPly?: number
}

/** 大师棋谱库记录（转换脚本产出的精简 JSON 条目） */
export interface MasterRecord {
  /** 东萍 gameid */
  id: number
  /** 标题 */
  t?: string
  /** 赛事 */
  e?: string
  /** 日期 */
  d?: string
  /** 红方 */
  r?: string
  /** 黑方 */
  b?: string
  /** 结果: 红胜 | 黑胜 | 和棋 | 其他 */
  res?: string
  /** movelist 原始串 */
  mv: string
}

/** 中文结果 → PGN 结果 */
export function mapResult(cn: string | undefined): string {
  if (cn === '红胜') return '1-0'
  if (cn === '黑胜') return '0-1'
  if (cn === '和棋' || cn === '和局') return '1/2-1/2'
  return '*'
}

/** 从文本中拆出所有 [DhtmlXQ]...[/DhtmlXQ] 块 */
export function splitDhtmlXQGames(text: string): string[] {
  const out: string[] = []
  const re = /\[DhtmlXQ\]([\s\S]*?)\[\/DhtmlXQ\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

/** 提取块内所有标签字段 */
function extractFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const re = /\[DhtmlXQ_(\w+)\]([^\[]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) fields[m[1]] = m[2].trim()
  return fields
}

/**
 * dpxq 坐标 → 应用 UCI
 * "7747" → "h2e2"（红炮二平五）
 */
export function dpxqPairToUci(s: string, i: number): string {
  const x1 = s.charCodeAt(i) - 48
  const y1 = s.charCodeAt(i + 1) - 48
  const x2 = s.charCodeAt(i + 2) - 48
  const y2 = s.charCodeAt(i + 3) - 48
  return String.fromCharCode(97 + x1) + (9 - y1) + String.fromCharCode(97 + x2) + (9 - y2)
}

/**
 * 由大师棋谱库记录构建完整 Game（逐步验证合法性并生成中文记谱）
 */
export function buildGameFromRecord(rec: MasterRecord): DpxqParseResult {
  const mv = rec.mv || ''
  if (!mv || mv.length % 4 !== 0 || /[^0-9]/.test(mv)) {
    return { success: false, error: '着法序列无效或为空' }
  }

  const header: GameHeader = {}
  if (rec.t) header.Title = rec.t
  if (rec.e) header.Event = rec.e
  // 无效日期归一化为空
  const date = rec.d && /^0000/.test(rec.d) ? '' : rec.d
  if (date) header.Date = date
  if (rec.r) header.Red = rec.r
  if (rec.b) header.Black = rec.b

  const result = mapResult(rec.res)
  const game = createEmptyGame()
  game.id = `dpxq_${rec.id}`
  game.header = { ...game.header, ...header, Site: '东萍象棋网', Source: `dpxq:${rec.id}` }
  game.startFen = START_FEN
  game.result = result
  game.header.Result = result

  let currentFen = START_FEN
  for (let i = 0; i < mv.length; i += 4) {
    const uci = dpxqPairToUci(mv, i)
    const state = boardFromFen(currentFen)
    const from = { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) }
    const to = { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) }
    const legal = getLegalMoves(state, from.col, from.row)
    if (!legal.some(m => m.col === to.col && m.row === to.row)) {
      return {
        success: false,
        error: `第 ${game.plies.length + 1} 步 "${uci}" 不合法`,
        errorPly: game.plies.length + 1,
      }
    }
    const { game: ng } = addPlyToGame(game, uci, currentFen)
    game.plies = ng.plies
    currentFen = ng.plies[ng.plies.length - 1].fenAfter
  }

  // 保留棋谱声明的结果（重建过程中会被局面状态覆盖）
  game.result = result
  game.header.Result = result
  return { success: true, game }
}

/** 解析单个 [DhtmlXQ] 块内容 */
export function parseDhtmlXQBlock(block: string): DpxqParseResult {
  const f = extractFields(block)

  if (f.binit && f.binit.length > 0) {
    return { success: false, error: '该棋谱含自定义初始局面（binit），暂不支持' }
  }
  if (!f.movelist) {
    return { success: false, error: '缺少 movelist 字段' }
  }

  return buildGameFromRecord({
    id: parseInt(f.gameid || '0', 10) || 0,
    t: f.title,
    e: f.event,
    d: f.date,
    r: f.red,
    b: f.black,
    res: f.result,
    mv: f.movelist,
  })
}

/** 解析包含一个或多个 DhtmlXQ 块的文本 */
export function parseDhtmlXQText(text: string): DpxqParseResult {
  const blocks = splitDhtmlXQGames(text)
  if (blocks.length === 0) {
    return { success: false, error: '未找到 [DhtmlXQ] 棋谱块' }
  }
  // 多块时取第一个成功的；全部失败则返回首个错误
  let firstError: string | undefined
  for (const block of blocks) {
    const r = parseDhtmlXQBlock(block)
    if (r.success) return r
    if (!firstError) firstError = r.error
  }
  return { success: false, error: firstError || '解析失败' }
}

/** 文本是否为 DhtmlXQ 格式 */
export function isDhtmlXQText(text: string): boolean {
  return text.includes('[DhtmlXQ')
}
