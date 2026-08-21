/**
 * 对局数据模型
 *
 * 严格遵循计划文档第3节的核心数据设计原则：
 *   - PGN 作为标准交换格式
 *   - 内部不直接使用 PGN 文本
 *   - Moves 以 Ply 为基本单位
 *   - 每个 Ply 对应一个局面
 *   - 棋谱与 AI 分析解耦
 *
 * 结构:
 *   Game
 *   ├── Header        (PGN 标签，key-value 可扩展)
 *   ├── StartFEN      (初始局面)
 *   ├── Plies[]       (每步棋 = 一个 Ply 对象)
 *   │   ├── move      (UCI 走法)
 *   │   ├── fen       (走棋后的局面)
 *   │   └── analysis  (AI 分析，可选)
 *   └── Result        (对局结果)
 */

import type { Pos, Turn } from './board'
import { boardFromFen, boardToFen, makeMove, START_FEN } from './board'
import { getLegalMoves, getGameStatus, isInCheck, moveToChinese } from './rules'

// ── Ply 模型 ──────────────────────────────────────────────────────

export interface Ply {
  /** 步序号（从1开始） */
  plyIndex: number
  /** 走棋方 */
  turn: Turn
  /** 走法 (UCI 格式) */
  move: string
  /** 中文棋谱 (如 '炮二平五') */
  moveCn: string
  /** 走棋前的 FEN */
  fenBefore: string
  /** 走棋后的 FEN */
  fenAfter: string
  /** 是否将军 */
  inCheck: boolean
  /** 是否吃子 */
  isCapture: boolean
  /** 被吃棋子 */
  capturedPiece?: string
  /** 时间戳（可选） */
  timestamp?: number
  /** AI 分析 (独立存储，不污染棋谱) */
  analysis?: PlyAnalysis
}

// ── 分析模型 ──────────────────────────────────────────────────────

export interface PlyAnalysis {
  /** 引擎评估分数（厘兵） */
  score: number
  /** 引擎深度 */
  depth: number
  /** 最佳走法 (UCI) */
  bestMove: string
  /** 最佳走法中文 */
  bestMoveCn?: string
  /** 主变化 PV */
  pv: string[]
  /** 走法损失 (实际走法与最佳走法的分差) */
  moveLoss: number
  /** 走法分类 */
  classification: MoveClassification
  /** 分析时间戳 */
  analyzedAt: number
}

export type MoveClassification =
  | 'best'       // 最佳
  | 'excellent'  // 优秀
  | 'good'       // 正常
  | 'inaccuracy' // 次优
  | 'mistake'    // 疑问 ?!
  | 'blunder'    // 失误 ?
  | 'blunder2'   // 严重失误 ??
  | 'unknown'    // 未分类

// ── Header 模型 ───────────────────────────────────────────────────

export interface GameHeader {
  [key: string]: string  // 支持任意 key-value，不写死字段
}

// ── Game 模型 ─────────────────────────────────────────────────────

export interface Game {
  /** 唯一 ID */
  id: string
  /** PGN Header (可扩展) */
  header: GameHeader
  /** 初始局面 FEN */
  startFen: string
  /** 每步棋 (Ply 数组，按顺序) */
  plies: Ply[]
  /** 最终结果 */
  result: string
  /** 创建时间 */
  createdAt: number
  /** 最后修改时间 */
  updatedAt: number
  /** 是否已收藏 */
  starred: boolean
  /** 分析状态 */
  analysisStatus: 'none' | 'partial' | 'complete'
  /** 分析设置 */
  analysisSettings?: AnalysisSettings
}

export interface AnalysisSettings {
  /** 分析深度 */
  depth: number
  /** 分析模式 */
  mode: 'quick' | 'standard' | 'deep' | 'ultra'
}

// ── 工具函数 ──────────────────────────────────────────────────────

/** 生成唯一 ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 创建空棋谱 */
export function createEmptyGame(): Game {
  return {
    id: generateId(),
    header: {
      Game: 'Chinese Chess',
      Event: '',
      Site: '',
      Date: new Date().toISOString().slice(0, 10),
      Round: '',
      Red: '',
      Black: '',
      Result: '*',
    },
    startFen: START_FEN,
    plies: [],
    result: '*',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    starred: false,
    analysisStatus: 'none',
  }
}

/** 从对局状态创建棋谱（自动保存时调用） */
export function createGameFromPlay(
  header: GameHeader,
  startFen: string,
  plies: Ply[],
  result: string,
): Game {
  return {
    id: generateId(),
    header: { ...header, Result: result },
    startFen,
    plies: [...plies],
    result,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    starred: false,
    analysisStatus: 'none',
  }
}

/** 根据 Ply 数组重建 FEN 序列 */
export function rebuildFenSequence(startFen: string, plies: Ply[]): string[] {
  const fens: string[] = [startFen]
  let state = boardFromFen(startFen)

  for (const ply of plies) {
    const from = { col: ply.move[0].charCodeAt(0) - 97, row: parseInt(ply.move[1]) }
    const to = { col: ply.move[2].charCodeAt(0) - 97, row: parseInt(ply.move[3]) }
    const move = {
      from,
      to,
      turn: ply.turn,
    }
    state = makeMove(state, move)
    fens.push(boardToFen(state))
  }

  return fens
}

/** 根据 Ply 数组重建第 N 步后的棋盘状态 */
export function getStateAtPly(startFen: string, plies: Ply[], plyIndex: number) {
  let state = boardFromFen(startFen)
  for (let i = 0; i < plyIndex && i < plies.length; i++) {
    const ply = plies[i]
    const from = { col: ply.move[0].charCodeAt(0) - 97, row: parseInt(ply.move[1]) }
    const to = { col: ply.move[2].charCodeAt(0) - 97, row: parseInt(ply.move[3]) }
    state = makeMove(state, { from, to, turn: ply.turn })
  }
  return state
}

/** 添加一步棋到棋谱 */
export function addPlyToGame(
  game: Game,
  move: string,
  fenBefore: string,
): { game: Game; ply: Ply } {
  const state = boardFromFen(fenBefore)
  const from = { col: move[0].charCodeAt(0) - 97, row: parseInt(move[1]) }
  const to = { col: move[2].charCodeAt(0) - 97, row: parseInt(move[3]) }

  const capturedPiece = state.board[to.col][to.row]
  const isCapture = capturedPiece !== '.'

  const newState = makeMove(state, { from, to, turn: state.turn })
  const status = getGameStatus(newState)

  const plyIndex = game.plies.length + 1
  const ply: Ply = {
    plyIndex,
    turn: state.turn,
    move,
    moveCn: moveToChinese(state, { from, to, turn: state.turn }),
    fenBefore,
    fenAfter: boardToFen(newState),
    inCheck: status.inCheck,
    isCapture,
    capturedPiece: isCapture ? capturedPiece : undefined,
    timestamp: Date.now(),
  }

  const updatedGame: Game = {
    ...game,
    plies: [...game.plies, ply],
    result: status.result,
    updatedAt: Date.now(),
    header: { ...game.header, Result: status.result },
  }

  return { game: updatedGame, ply }
}

/** 获取棋谱的 FEN 序列 */
export function getFenSequence(game: Game): string[] {
  return rebuildFenSequence(game.startFen, game.plies)
}

/** 获取棋谱所有局面的字符串表示（用于三次重复判定） */
export function getPositionStrings(game: Game): string[] {
  const fens = getFenSequence(game)
  return fens.map(fen => fen.replace(/\s+\d+ \d+$/, '')) // 去掉 halfmove/fullmove
}
