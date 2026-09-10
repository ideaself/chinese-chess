/**
 * 开局训练数据 - 计划第22节"开局训练"
 *
 * 两条数据来源：
 *   1. `OPENING_LINES`：内置经典定式（离线兜底，4 条）
 *   2. 开局书生成：从 141k 局大师语料（public/opening-book.json）按频率走主线，
 *      用棋谱库分类逻辑命名，并带上"多少局走过、红方得分率"——真实语料驱动
 *
 * 界面与 slice 一律通过 `getOpeningLines()` 取线路（生成成功则用生成的）。
 * 玩家执红按理论顺序行棋，走对继续、走偏提示正确着法；对手一侧由系统自动演示。
 */

import { boardFromFen, boardToFen, makeMove, START_FEN } from './board'
import { chineseFromFen } from './rules'
import { getBookCandidates, getBookFirstMoves, loadOpeningBook } from './book'
import { classifyRecord, FAMILY_INFO, DEFENSE_INFO } from './openingClassify'
import type { MasterRecord } from './dhtmlxq'

export interface OpeningLine {
  id: string
  name: string
  desc: string
  /** 理论着法序列（UCI，红黑交替，红先） */
  moves: string[]
  /** 与 moves 一一对应的中文名称 */
  names: string[]
  /** 每步的简要讲解 */
  notes: string[]
}

// ── 语料生成线路（v1.22） ─────────────────────────────────────────

/** 生成线路的默认深度（手）与首着数量 */
export const BOOK_LINE_PLIES = 10
export const BOOK_LINE_COUNT = 8
/** 冷门线路阈值：到达局数少于此值的首着不生成线路 */
export const MIN_LINE_GAMES = 100

let dynamicLines: OpeningLine[] | null = null

/** 当前可用线路：优先语料生成，其次内置定式 */
export function getOpeningLines(): OpeningLine[] {
  return dynamicLines ?? OPENING_LINES
}

/** 测试辅助：注入/清空生成的线路 */
export function _setOpeningLinesForTest(lines: OpeningLine[] | null): void {
  dynamicLines = lines
}

/** 该局面下各候选着法的总局数（= 走到该局面的局数） */
function gamesAt(prefix: string[]): number {
  const cands = getBookCandidates(prefix)
  return cands ? cands.reduce((sum, c) => sum + c.n, 0) : 0
}

/** 在棋盘上执行一步 UCI 着法 */
function applyUci(board: ReturnType<typeof boardFromFen>, uci: string) {
  const from = { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) }
  const to = { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) }
  return makeMove(board, { from, to, turn: board.turn })
}

/** 沿开局书按"出现次数最多"走主线（首手固定为 firstMove），返回 UCI 序列与逐手统计 */
function walkMainLine(firstMove: string): {
  moves: string[]
  notes: string[]
  names: string[]
  reachedGames: number
} | null {
  const moves: string[] = []
  const notes: string[] = []
  const names: string[] = []
  let board = boardFromFen(START_FEN)

  // 首手统计优先取起始局面候选表；多数首着不在该表中（book-gen 已裁剪），
  // 退化为"其后继局数"，只显示局数不显示得分率
  const firstStat = getBookCandidates([])?.find(c => c.m === firstMove)
  const firstCn = chineseFromFen(boardToFen(board), firstMove)
  notes.push(firstStat
    ? `${firstCn}：${firstStat.n.toLocaleString()} 局，红方得分率 ${Math.round(firstStat.wr * 100)}%`
    : firstCn)
  names.push(firstCn)
  moves.push(firstMove)
  board = applyUci(board, firstMove)

  for (let ply = 1; ply < BOOK_LINE_PLIES; ply++) {
    const cands = getBookCandidates(moves)
    if (!cands || cands.length === 0) break
    const top = cands[0]
    const cn = chineseFromFen(boardToFen(board), top.m)
    names.push(cn)
    notes.push(`${cn}：${top.n.toLocaleString()} 局，红方得分率 ${Math.round(top.wr * 100)}%`)
    moves.push(top.m)
    board = applyUci(board, top.m)
  }

  if (moves.length < 4) return null
  // 走到最终局面的局数；最终局面无记录时用上一位置的局数
  const reachedGames = gamesAt(moves) || gamesAt(moves.slice(0, -1))
  return { moves, notes, names, reachedGames }
}

/** 线路名称：复用棋谱库的开局分类（中炮对屏风马等） */
function nameOfLine(moves: string[]): { name: string; desc: string } {
  const cls = classifyRecord({ id: 0, mv: moves.join('') } as MasterRecord)
  const family = FAMILY_INFO[cls.family]
  if (cls.family !== 'other' && cls.defense) {
    const def = DEFENSE_INFO[cls.defense]
    return { name: `${family.name}对${def.name}`, desc: `${family.desc}；黑方以${def.name}应对` }
  }
  return { name: family.name, desc: family.desc }
}

/**
 * 从开局书生成训练线路：取语料中出现最多的若干首着，各走一条主线。
 * 开局书未加载或数据不足时返回空数组。
 */
export async function buildOpeningLinesFromBook(): Promise<OpeningLine[]> {
  const ok = await loadOpeningBook()
  if (!ok) return []
  const firstMoves = getBookFirstMoves()
  if (firstMoves.length === 0) return []

  const built: OpeningLine[] = []
  for (const first of firstMoves) {
    const line = walkMainLine(first)
    // 少于 200 局的冷门线路不进训练（避免把边角着法当定式教）
    if (!line || line.reachedGames < MIN_LINE_GAMES) continue
    const { name, desc } = nameOfLine(line.moves)
    built.push({
      id: `book:${line.moves.join('')}`,
      name,
      desc: `${desc} · 语料约 ${line.reachedGames.toLocaleString()} 局走到此局面`,
      moves: line.moves,
      names: line.names,
      notes: line.notes,
    })
  }
  // 同一体系可能生成多条，按到达局数取前 N 条
  return built.slice(0, BOOK_LINE_COUNT)
}

/** 拉取开局书并生成线路（幂等；失败保持内置定式） */
let buildPromise: Promise<void> | null = null
export function ensureBookOpeningLines(): Promise<void> {
  if (!buildPromise) {
    const p = buildOpeningLinesFromBook()
      .then(lines => { if (lines.length > 0) dynamicLines = lines })
      .catch(() => { /* 保持内置定式 */ })
    buildPromise = p
    // 生成失败/为空时不永久缓存，下次进入训练可重试
    void p.finally(() => { if (!dynamicLines) buildPromise = null })
  }
  return buildPromise
}
export const OPENING_LINES: OpeningLine[] = [
  {
    id: 'zhongpao-pingfeng',
    name: '中炮对屏风马',
    desc: '最经典的开局体系：中炮抢攻对屏风马固守，学象棋的第一课。',
    moves: ['h2e2', 'b9c7', 'h0g2', 'h9g7', 'i0h0', 'i9h9', 'c3c4', 'c6c5'],
    names: ['炮二平五', '马2进3', '马二进三', '马8进7', '车一平二', '车9平8', '兵七进一', '卒3进1'],
    notes: [
      '抢占中路，威胁最强',
      '屏风马护中卒，稳正应对',
      '开活右马，连结中路',
      '左马跟上，双马连环',
      '出右车抢亮，压制黑车',
      '黑车同步亮出，针锋相对',
      '挺七兵活左马，兼制黑马',
      '对称挺卒，阵型工整',
    ],
  },
  {
    id: 'shunpao-basic',
    name: '顺炮直车',
    desc: '双方同为中炮、同侧炮的对抗，节奏最快，适合学习抢先出车。',
    moves: ['h2e2', 'h7e7', 'h0g2', 'b9c7', 'i0h0', 'i9i8'],
    names: ['炮二平五', '炮8平5', '马二进三', '马2进3', '车一平二', '车9进1'],
    notes: [
      '架中炮正面强攻',
      '顺炮还击，针尖对麦芒',
      '先跳右边马护中兵',
      '跳马保中卒兼制红马',
      '亮出主力车，抢占要道',
      '高横车蓄势，灵活机动',
    ],
  },
  {
    id: 'feixiang-basic',
    name: '飞相局',
    desc: '以静制动的高弹性开局，先稳固自身再伺机反击。',
    moves: ['c0e2', 'b7c7', 'h0g2', 'h9g7'],
    names: ['相三进五', '马2进3', '马二进三', '马8进7'],
    notes: [
      '飞相固防，后发制人',
      '黑跳右马正常展开',
      '红跳右马，阵型均衡',
      '黑也跳屏风马，各行其是',
    ],
  },
  {
    id: 'guogongpao',
    name: '过宫炮',
    desc: '炮移宫角蓄势待发，阵型厚实，流行于高水平对局。',
    moves: ['b2d2', 'h9g7', 'c0e2', 'b9c7'],
    names: ['炮八平六', '马8进7', '相三进五', '马2进3'],
    notes: [
      '炮过宫角，集中子力',
      '黑跳屏风马常规应对',
      '飞相连环，巩固阵地',
      '黑亦稳步出子',
    ],
  },
]
