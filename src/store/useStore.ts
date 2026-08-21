/**
 * 应用状态管理 (Zustand)
 *
 * 严格遵循计划文档的对局流程:
 *   开始对局 → 人机对战 → 自动保存棋谱 → 查看棋谱 → AI 分析
 *
 * 集成模块:
 *   - board.ts: 棋盘表示
 *   - rules.ts: 完整规则（将军/将死/飞将）
 *   - model.ts: Game/Ply 数据模型
 *   - pgn.ts: PGN 解析/导出
 *   - storage.ts: 持久化
 *   - pikafish.ts: AI 引擎
 */

import { create } from 'zustand'
import type { BoardState } from '../game/board'
import {
  createGame as createBoardGame, makeMove, boardToFen,
  boardFromFen, createEmptyBoard, START_FEN,
} from '../game/board'
import type { Move, Pos, Turn } from '../game/board'
import {
  getLegalMoves, getGameStatus, isInCheck, getAllLegalMoves, chineseFromFen,
} from '../game/rules'
import type { Game, Ply, PlyAnalysis } from '../game/model'
import {
  createEmptyGame, addPlyToGame, getStateAtPly, getFenSequence,
} from '../game/model'
import { parsePGN, exportPGN } from '../game/pgn'
import {
  saveGame as storageSaveGame, getAllGames, getSettings,
  deleteGame as storageDeleteGame,
} from '../game/storage'
import { PikafishEngine } from '../engine/pikafish'
import { moveToUci, uciToMove } from '../engine/uci'
import { playMoveSound, playCaptureSound, playCheckSound, resumeAudio } from '../game/sound'

// ── 类型定义 ──────────────────────────────────────────────────────

export type GameMode = 'play' | 'replay' | 'analysis' | 'puzzle' | 'setup'
export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'master' | 'grandmaster'
export type TabType = 'play' | 'games' | 'analysis' | 'settings'

/** 摆棋工具（计划第16节） */
export type SetupTool =
  | { kind: 'piece'; piece: string }
  | { kind: 'erase' }

/** 摆棋分析候选着法 */
export interface CandidateLine {
  move: string
  score: number
  pv: string[]
}

export interface AnalysisInfo {
  depth: number
  score: number
  bestMove: string
  pv: string[]
  fen: string
}

/** 提示结果（对战页横幅显示，计划第6.4节） */
export interface HintInfo {
  moveCn: string
  score: number
}

interface AppState {
  // ── 引擎 ──
  engine: PikafishEngine | null
  engineReady: boolean
  isThinking: boolean
  engineDepth: number
  analysis: AnalysisInfo | null
  hintInfo: HintInfo | null
  /** 整盘分析进度 */
  analysisProgress: { current: number; total: number } | null

  // ── 对局状态 ──
  mode: GameMode
  game: Game
  /** 当前棋盘状态 (由 game 的 plies 重建) */
  board: BoardState
  difficulty: Difficulty
  playerSide: Turn
  boardFlipped: boolean

  // ── 摆棋模式 (计划第16节) ──
  modeBeforeSetup: GameMode
  setupTool: SetupTool
  /** 摆棋局面的行棋方（分析用） */
  setupTurn: Turn
  /** 摆棋分析结果（多 PV 候选） */
  setupCandidates: CandidateLine[] | null
  setupError: string

  // ── 错误重走 (计划第17节) ──
  /** 正在重走的 Ply 序号（0-based，决策局面 = 该步之前） */
  puzzlePlyIndex: number | null
  puzzleAttempts: number
  puzzleResult: 'waiting' | 'correct' | 'wrong'
  puzzleRevealed: boolean

  // ── UI 状态 ──
  activeTab: TabType
  /** 全局轻提示（自动消失） */
  toast: string | null
  showToast: (msg: string) => void

  // ── 对局控制 ──
  currentPlyIndex: number  // 当前查看的 Ply 序号 (0 = 初始局面)
  selected: Pos | null
  legalTargets: Pos[]
  lastMove: Move | null

  // ── 计时器 ──
  redTime: number   // 毫秒
  blackTime: number
  timerInterval: ReturnType<typeof setInterval> | null

  // ── 棋谱列表 ──
  savedGames: Game[]

  // ── 操作 ──
  init: () => Promise<void>
  startNewGame: (difficulty: Difficulty, playerSide: Turn) => void
  selectPiece: (pos: Pos) => void
  tryMove: (from: Pos, to: Pos) => boolean
  undo: () => void
  restart: () => void
  flipBoard: () => void
  setDifficulty: (d: Difficulty) => void
  setTab: (tab: TabType) => void
  aiMove: () => Promise<void>
  aiHint: () => Promise<void>
  resign: () => void
  offerDraw: () => void

  // ── 棋谱操作 ──
  saveCurrentGame: () => void
  loadGame: (id: string) => void
  loadFromPGN: (pgn: string) => void
  exportCurrentPGN: () => string
  deleteGameById: (id: string) => void

  // ── 重放控制 ──
  goToStart: () => void
  goToEnd: () => void
  goBack: () => void
  goForward: () => void
  goToPly: (index: number) => void

  // ── AI 分析 ──
  analyzeCurrentGame: () => Promise<void>
  analyzePosition: () => Promise<void>
  /** 取消整盘分析（当前局面完成后停止） */
  cancelAnalysis: () => void

  // ── 摆棋模式 (计划第16节) ──
  enterSetup: () => void
  exitSetup: () => void
  setupClick: (pos: Pos) => void
  setSetupTool: (tool: SetupTool) => void
  setSetupTurn: (t: Turn) => void
  clearSetupBoard: () => void
  resetSetupBoard: () => void
  analyzeSetupPosition: () => Promise<void>

  // ── 错误重走 (计划第17节) ──
  startPuzzle: (plyIndex: number) => void
  exitPuzzle: () => void
  puzzleTryMove: (from: Pos, to: Pos) => boolean
  revealPuzzleAnswer: () => void
  /** 从错题本跨棋谱发起重走 */
  startPuzzleFromGame: (gameId: string, plyIndex: number) => void
  /** 残局训练：以指定 FEN 开局，玩家执红 vs 引擎 */
  startEndgameTraining: (fen: string, name: string) => void

  // ── 刷新 ──
  refreshSavedGames: () => void
}

// ── 难度配置 ──────────────────────────────────────────────────────

const DIFFICULTY_DEPTH: Record<Difficulty, number> = {
  beginner: 2,
  easy: 4,
  medium: 10,
  hard: 16,
  master: 20,
  grandmaster: 28,
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: '入门',
  easy: '初级',
  medium: '中级',
  hard: '高级',
  master: '大师',
  grandmaster: '特级大师',
}

export { DIFFICULTY_LABELS }

// ── 辅助函数 ──────────────────────────────────────────────────────

function boardFromGame(game: Game, plyIndex: number): BoardState {
  if (plyIndex === 0) return boardFromFen(game.startFen)
  const state = getStateAtPly(game.startFen, game.plies, plyIndex)
  return state
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** toast 自动消失定时器 */
let toastTimer: ReturnType<typeof setTimeout> | null = null

/** 整盘分析取消标记 */
let analysisCancelFlag = false

// ── Store ─────────────────────────────────────────────────────────

export const useStore = create<AppState>((set, get) => ({
  // ── 引擎 ──
  engine: null,
  engineReady: false,
  isThinking: false,
  engineDepth: 10,
  analysis: null,
  hintInfo: null,
  analysisProgress: null,

  // ── 对局状态 ──
  mode: 'play',
  game: createEmptyGame(),
  board: boardFromFen(START_FEN),
  difficulty: 'medium',
  playerSide: 'w',
  boardFlipped: false,

  // ── 摆棋模式 ──
  modeBeforeSetup: 'play',
  setupTool: { kind: 'erase' },
  setupTurn: 'w',
  setupCandidates: null,
  setupError: '',

  // ── 错误重走 ──
  puzzlePlyIndex: null,
  puzzleAttempts: 0,
  puzzleResult: 'waiting',
  puzzleRevealed: false,

  // ── UI 状态 ──
  activeTab: 'play',
  toast: null,
  showToast: (msg) => {
    set({ toast: msg })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 4000)
  },

  // ── 对局控制 ──
  currentPlyIndex: 0,
  selected: null,
  legalTargets: [],
  lastMove: null,

  // ── 计时器 ──
  redTime: 0,
  blackTime: 0,
  timerInterval: null,

  // ── 棋谱列表 ──
  savedGames: [],

  // ══════════════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════════════

  init: async () => {
    resumeAudio()
    const engine = new PikafishEngine({ depth: DIFFICULTY_DEPTH.medium })
    try {
      await engine.init()
      set({ engine, engineReady: true })
    } catch (e) {
      console.error('引擎初始化失败:', e)
    }
    set({ savedGames: getAllGames() })
  },

  // ══════════════════════════════════════════════════════════════════
  // 对局控制
  // ══════════════════════════════════════════════════════════════════

  startNewGame: (difficulty, playerSide) => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)

    const game = createEmptyGame()
    game.header.Red = playerSide === 'w' ? '玩家' : DIFFICULTY_LABELS[difficulty]
    game.header.Black = playerSide === 'b' ? '玩家' : DIFFICULTY_LABELS[difficulty]

    set({
      mode: 'play',
      game,
      board: boardFromFen(game.startFen),
      difficulty,
      playerSide,
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
      analysis: null,
      hintInfo: null,
      redTime: 0,
      blackTime: 0,
    })

    // 更新引擎深度
    const { engine } = get()
    if (engine && engine.isReady) {
      engine.setDepth(DIFFICULTY_DEPTH[difficulty])
    }

    // 启动计时器 (红方先手)
    const interval = setInterval(() => {
      const { mode, board, redTime, blackTime } = get()
      if (mode !== 'play') return
      
      if (board.turn === 'w') {
        set({ redTime: redTime + 100 })
      } else {
        set({ blackTime: blackTime + 100 })
      }
    }, 100)
    set({ timerInterval: interval })

    // AI 先手时自动走棋
    if (playerSide === 'b') {
      setTimeout(() => get().aiMove(), 500)
    }
  },

  selectPiece: (pos) => {
    const state = get()
    const { board, selected, mode } = state
    if (mode !== 'play' && mode !== 'puzzle') return

    const piece = board.board[pos.col][pos.row]

    if (selected && selected.col === pos.col && selected.row === pos.row) {
      set({ selected: null, legalTargets: [] })
      return
    }

    if (selected) {
      const result = get().tryMove(selected, pos)
      if (result) return
    }

    if (piece !== '.') {
      const red = piece === piece.toUpperCase()
      const turnRed = board.turn === 'w'
      if (red !== turnRed) {
        set({ selected: null, legalTargets: [] })
        return
      }
      const targets = getLegalMoves(board, pos.col, pos.row)
      set({ selected: pos, legalTargets: targets })
    } else {
      set({ selected: null, legalTargets: [] })
    }
  },

  tryMove: (from, to) => {
    const { board, mode, game, engine, engineReady, playerSide } = get()

    if (mode === 'puzzle') return get().puzzleTryMove(from, to)
    if (mode !== 'play') return false

    const piece = board.board[from.col][from.row]

    const legalMoves = getLegalMoves(board, from.col, from.row)
    const isTargetLegal = legalMoves.some(m => m.col === to.col && m.row === to.row)

    if (!isTargetLegal) {
      set({ selected: null, legalTargets: [] })
      return false
    }

    const uci = `${String.fromCharCode(97 + from.col)}${from.row}${String.fromCharCode(97 + to.col)}${to.row}`
    const fenBefore = boardToFen(board)

    // 添加 Ply 到 Game
    const { game: updatedGame, ply } = addPlyToGame(game, uci, fenBefore)

    // 更新棋盘
    const newState = boardFromFen(ply.fenAfter)

    // 检查对局状态
    const status = getGameStatus(newState, getFenSequence(updatedGame))

    set({
      game: updatedGame,
      board: newState,
      currentPlyIndex: updatedGame.plies.length,
      selected: null,
      legalTargets: [],
      lastMove: { from, to, turn: board.turn },
      analysis: null,
      hintInfo: null,
    })

    // 音效
    const settings = getSettings()
    const captured = board.board[to.col][to.row] !== '.'
    if (captured) {
      playCaptureSound(settings.soundCapture)
    } else {
      playMoveSound(settings.soundMove)
    }
    if (status.inCheck) {
      playCheckSound(settings.soundCheck)
    }

    // 对局结束
    if (status.isGameOver) {
      const { timerInterval } = get()
      if (timerInterval) clearInterval(timerInterval)
      set({ timerInterval: null })
      get().saveCurrentGame()
      return true
    }

    // AI 模式：轮到 AI 走棋
    if (mode === 'play' && engineReady && engine) {
      const aiSide = playerSide === 'w' ? 'b' : 'w'
      if (newState.turn === aiSide) {
        setTimeout(() => get().aiMove(), 200)
      }
    }

    return true
  },

  undo: () => {
    const { game, mode, currentPlyIndex, playerSide } = get()
    if (mode !== 'play' || get().isThinking) return
    if (game.result !== '*') return
    if (currentPlyIndex <= 0) return

    /** 第 k 个局面轮到谁走 */
    const turnAt = (k: number): Turn => {
      if (k === 0) return boardFromFen(game.startFen).turn
      return game.plies[k - 1].turn === 'w' ? 'b' : 'w'
    }

    // 撤回到最近的"轮到玩家行棋"的局面（严格早于当前）
    let target = currentPlyIndex - 1
    while (target > 0 && turnAt(target) !== playerSide) target--

    const updatedGame: Game = {
      ...game,
      plies: game.plies.slice(0, target),
      result: '*',
      updatedAt: Date.now(),
    }
    updatedGame.header = { ...updatedGame.header, Result: '*' }

    set({
      game: updatedGame,
      board: boardFromGame(updatedGame, target),
      currentPlyIndex: target,
      selected: null,
      legalTargets: [],
      lastMove: target > 0
        ? parseMoveFromUci(updatedGame.plies[target - 1].move, updatedGame.plies[target - 1].turn)
        : null,
      analysis: null,
      hintInfo: null,
    })

    // 撤完轮到 AI（如玩家执黑撤回开局）→ 让 AI 重走
    if (turnAt(target) !== playerSide) {
      setTimeout(() => get().aiMove(), 300)
    }
  },

  restart: () => {
    const { difficulty, playerSide } = get()
    get().startNewGame(difficulty, playerSide)
  },

  flipBoard: () => set(s => ({ boardFlipped: !s.boardFlipped })),

  setDifficulty: (d) => {
    set({ difficulty: d })
    const { engine } = get()
    if (engine && engine.isReady) {
      engine.setDepth(DIFFICULTY_DEPTH[d])
    }
  },

  setTab: (tab) => set({ activeTab: tab }),

  // ══════════════════════════════════════════════════════════════════
  // AI 走棋
  // ══════════════════════════════════════════════════════════════════

  aiMove: async () => {
    const { game, engine, engineDepth, mode, playerSide } = get()
    if (!engine || !engine.isReady || get().isThinking) return
    if (mode !== 'play') return

    const aiSide = playerSide === 'w' ? 'b' : 'w'
    const currentBoard = boardFromGame(game, game.plies.length)
    if (currentBoard.turn !== aiSide) return

    set({ isThinking: true })

    try {
      const fen = boardToFen(currentBoard)
      const moveList = game.plies.map(p => p.move)

      const bestUci = await engine.go(fen, moveList, engineDepth)

      if (bestUci && bestUci !== '(none)' && bestUci.length >= 4) {
        const from = { col: bestUci.charCodeAt(0) - 97, row: parseInt(bestUci[1]) }
        const to = { col: bestUci.charCodeAt(2) - 97, row: parseInt(bestUci[3]) }
        get().tryMove(from, to)
      }
    } catch (e) {
      console.error('AI 走棋失败:', e)
    } finally {
      set({ isThinking: false })
    }
  },

  aiHint: async () => {
    const { game, engine, engineDepth } = get()
    if (!engine || !engine.isReady) return

    const currentBoard = boardFromGame(game, game.plies.length)
    const fen = boardToFen(currentBoard)
    const moveList = game.plies.map(p => p.move)

    set({ isThinking: true })
    try {
      await engine.analyze(fen, moveList, Math.min(engineDepth, 14), (info) => {
        set({
          analysis: {
            depth: info.depth,
            score: info.score,
            bestMove: info.move,
            pv: info.pv,
            fen,
          },
        })
      })
      // 完成后生成中文提示（计划第6.4节：最佳着法 + 局面评价）
      const cur = get().analysis
      if (cur && cur.fen === fen && cur.bestMove.length >= 4) {
        set({
          hintInfo: {
            moveCn: chineseFromFen(fen, cur.bestMove),
            score: cur.score,
          },
        })
      }
    } catch (e) {
      console.error('AI 提示失败:', e)
    } finally {
      set({ isThinking: false })
    }
  },

  resign: () => {
    const { game, playerSide, mode, timerInterval } = get()
    if (mode !== 'play' || game.result !== '*') return
    if (timerInterval) clearInterval(timerInterval)
    const result = playerSide === 'w' ? '0-1' : '1-0'
    const updatedGame = { ...game, result, updatedAt: Date.now() }
    set({ game: updatedGame, timerInterval: null })
    get().saveCurrentGame()
  },

  offerDraw: () => {
    const { game, mode, timerInterval } = get()
    if (mode !== 'play' || game.result !== '*') return
    if (timerInterval) clearInterval(timerInterval)
    const updatedGame = { ...game, result: '1/2-1/2', updatedAt: Date.now() }
    set({ game: updatedGame, timerInterval: null })
    get().saveCurrentGame()
  },

  // ══════════════════════════════════════════════════════════════════
  // 棋谱操作
  // ══════════════════════════════════════════════════════════════════

  saveCurrentGame: () => {
    const { game } = get()
    if (game.plies.length === 0) return
    storageSaveGame(game)
    set({ savedGames: getAllGames() })
  },

  loadGame: (id) => {
    const games = getAllGames()
    const game = games.find(g => g.id === id)
    if (!game) return

    const board = boardFromGame(game, game.plies.length)
    set({
      mode: 'replay',
      game,
      board,
      currentPlyIndex: game.plies.length,
      selected: null,
      legalTargets: [],
      lastMove: game.plies.length > 0
        ? parseMoveFromUci(game.plies[game.plies.length - 1].move, game.plies[game.plies.length - 1].turn)
        : null,
      analysis: null,
      hintInfo: null,
      // 跳到对战页签，重放控件在该页签
      activeTab: 'play',
    })
  },

  loadFromPGN: (pgn: string) => {
    const result = parsePGN(pgn)
    if (!result.success || !result.game) {
      console.error('PGN 解析失败:', result.error)
      return false
    }
    const board = boardFromGame(result.game, result.game.plies.length)
    set({
      mode: 'replay',
      game: result.game,
      board,
      currentPlyIndex: result.game.plies.length,
      selected: null,
      legalTargets: [],
      lastMove: result.game.plies.length > 0
        ? parseMoveFromUci(result.game.plies[result.game.plies.length - 1].move, result.game.plies[result.game.plies.length - 1].turn)
        : null,
      hintInfo: null,
      activeTab: 'play',
    })
    return true
  },

  exportCurrentPGN: () => {
    return exportPGN(get().game)
  },

  deleteGameById: (id) => {
    storageDeleteGame(id)
    set({ savedGames: getAllGames() })
  },

  // ══════════════════════════════════════════════════════════════════
  // 重放控制
  // ══════════════════════════════════════════════════════════════════

  goToStart: () => {
    const { game } = get()
    set({
      currentPlyIndex: 0,
      board: boardFromGame(game, 0),
      selected: null,
      legalTargets: [],
      lastMove: null,
    })
  },

  goToEnd: () => {
    const { game } = get()
    const idx = game.plies.length
    set({
      currentPlyIndex: idx,
      board: boardFromGame(game, idx),
      selected: null,
      legalTargets: [],
      lastMove: idx > 0
        ? parseMoveFromUci(game.plies[idx - 1].move, game.plies[idx - 1].turn)
        : null,
    })
  },

  goBack: () => {
    const { currentPlyIndex, game } = get()
    if (currentPlyIndex <= 0) return
    const newIdx = currentPlyIndex - 1
    set({
      currentPlyIndex: newIdx,
      board: boardFromGame(game, newIdx),
      selected: null,
      legalTargets: [],
      lastMove: newIdx > 0
        ? parseMoveFromUci(game.plies[newIdx - 1].move, game.plies[newIdx - 1].turn)
        : null,
    })
  },

  goForward: () => {
    const { currentPlyIndex, game } = get()
    if (currentPlyIndex >= game.plies.length) return
    const ply = game.plies[currentPlyIndex]
    const newIdx = currentPlyIndex + 1
    set({
      currentPlyIndex: newIdx,
      board: boardFromGame(game, newIdx),
      selected: null,
      legalTargets: [],
      lastMove: parseMoveFromUci(ply.move, ply.turn),
    })
  },

  goToPly: (index) => {
    const { game } = get()
    const clamped = Math.max(0, Math.min(index, game.plies.length))
    set({
      currentPlyIndex: clamped,
      board: boardFromGame(game, clamped),
      selected: null,
      legalTargets: [],
      lastMove: clamped > 0
        ? parseMoveFromUci(game.plies[clamped - 1].move, game.plies[clamped - 1].turn)
        : null,
    })
  },

  // ══════════════════════════════════════════════════════════════════
  // AI 分析
  // ══════════════════════════════════════════════════════════════════

  analyzePosition: async () => {
    const { game, engine, engineDepth, currentPlyIndex } = get()
    if (!engine || !engine.isReady) return

    const currentBoard = boardFromGame(game, currentPlyIndex)
    const fen = boardToFen(currentBoard)

    set({ isThinking: true })
    try {
      await engine.analyze(fen, game.plies.slice(0, currentPlyIndex).map(p => p.move), engineDepth, (info) => {
        set({
          analysis: {
            depth: info.depth,
            score: info.score,
            bestMove: info.move,
            pv: info.pv,
            fen,
          },
        })
      })
    } catch (e) {
      console.error('分析失败:', e)
    } finally {
      set({ isThinking: false })
    }
  },

  analyzeCurrentGame: async () => {
    const { game, engine } = get()
    if (!engine || !engine.isReady || game.plies.length === 0) return

    const depth = Math.min(get().engineDepth, 16)
    const total = game.plies.length + 1
    analysisCancelFlag = false
    set({ isThinking: true, analysisProgress: { current: 0, total } })

    try {
      // ── 第一遍：分析全部 N+1 个局面（每步之前 + 终局）──
      // evals[i] = 第 i 步之前局面的评估（走棋方视角）
      interface PosEval { score: number; depth: number; bestMove: string; pv: string[] }
      const evals: PosEval[] = []
      let cancelled = false

      for (let i = 0; i <= game.plies.length; i++) {
        // 用户中途开新局/换棋谱时中止
        if (get().game.id !== game.id) { engine.stop(); return }
        if (analysisCancelFlag) { cancelled = true; break }

        set({ analysisProgress: { current: i + 1, total } })

        const board = boardFromGame(game, i)
        const fen = boardToFen(board)
        const moveList = game.plies.slice(0, i).map(p => p.move)

        await engine.analyze(fen, moveList, depth, (info) => {
          set({
            analysis: {
              depth: info.depth,
              score: info.score,
              bestMove: info.move,
              pv: info.pv,
              fen,
            },
          })
        })

        // 读取最终 info（fen 校验防止读到别的局面的残留回调）
        const cur = get().analysis
        if (cur && cur.fen === fen) {
          evals.push({ score: cur.score, depth: cur.depth, bestMove: cur.bestMove, pv: cur.pv })
        } else {
          evals.push({ score: 0, depth: 0, bestMove: '', pv: [] })
        }
      }

      // ── 第二遍：计算已完成部分的每步损失并分类 ──
      // before.score 为走棋方视角；after.score 为对方视角 → 取负回到走棋方视角
      const clamp = (v: number) => Math.max(-1500, Math.min(1500, v))
      // ply i 需要 evals[i] 与 evals[i+1]
      const computable = Math.max(0, evals.length - 1)

      const updatedPlies = game.plies.map((ply, i) => {
        if (i >= computable) return ply // 未分析部分保留原样（含旧分析）
        const before = evals[i]
        const after = evals[i + 1]
        const moveLoss = Math.max(0, clamp(before.score) + clamp(after.score))
        const classification = classifyMove(moveLoss)

        return {
          ...ply,
          analysis: {
            score: before.score,
            depth: before.depth,
            bestMove: before.bestMove,
            bestMoveCn: before.bestMove.length >= 4
              ? chineseFromFen(ply.fenBefore, before.bestMove)
              : '',
            pv: before.pv,
            moveLoss,
            classification,
            analyzedAt: Date.now(),
          },
        }
      })

      const finished = !cancelled && computable === game.plies.length
      const analyzedGame: Game = {
        ...get().game,
        plies: updatedPlies,
        analysisStatus: finished ? 'complete' : (computable > 0 ? 'partial' : 'none'),
      }
      set({ game: analyzedGame, analysisProgress: null })

      if (finished) {
        // 完整分析缓存到本地（不重复计战绩）
        storageSaveGame(analyzedGame)
        set({ savedGames: getAllGames() })
      } else if (cancelled) {
        get().showToast(`分析已取消（完成 ${computable}/${game.plies.length} 步）`)
      }
      analysisCancelFlag = false
    } catch (e) {
      console.error('整盘分析失败:', e)
    } finally {
      set({ isThinking: false, analysisProgress: null })
    }
  },

  cancelAnalysis: () => {
    analysisCancelFlag = true
    get().engine?.stop() // 尽快结束当前局面搜索
  },

  refreshSavedGames: () => {
    set({ savedGames: getAllGames() })
  },

  // ══════════════════════════════════════════════════════════════════
  // 摆棋模式 (计划第16节)
  // ══════════════════════════════════════════════════════════════════

  /** 从当前局面进入摆棋 */
  enterSetup: () => {
    const { mode, board } = get()
    if (mode === 'play') {
      const { timerInterval } = get()
      if (timerInterval) clearInterval(timerInterval)
      set({ timerInterval: null })
    }
    set({
      mode: 'setup',
      modeBeforeSetup: mode === 'setup' ? 'play' : mode,
      board: { ...board },
      setupTurn: board.turn,
      setupCandidates: null,
      setupError: '',
      selected: null,
      legalTargets: [],
      lastMove: null,
    })
  },

  exitSetup: () => {
    const { modeBeforeSetup, game, currentPlyIndex } = get()
    const backMode: GameMode = modeBeforeSetup === 'setup' ? 'play' : modeBeforeSetup
    set({
      mode: backMode,
      board: boardFromGame(game, currentPlyIndex),
      setupCandidates: null,
      setupError: '',
      lastMove: currentPlyIndex > 0
        ? parseMoveFromUci(game.plies[currentPlyIndex - 1].move, game.plies[currentPlyIndex - 1].turn)
        : null,
    })
  },

  /** 摆棋点击: 放子 / 擦除 */
  setupClick: (pos) => {
    const { board, setupTool } = get()
    const newBoard = board.board.map(col => [...col])
    const existing = newBoard[pos.col][pos.row]

    if (setupTool.kind === 'erase') {
      if (existing !== '.') newBoard[pos.col][pos.row] = '.'
    } else {
      // 点击同色同子 → 移除（toggle）；否则放置/替换
      if (existing === setupTool.piece) {
        newBoard[pos.col][pos.row] = '.'
      } else {
        newBoard[pos.col][pos.row] = setupTool.piece
      }
    }

    set({
      board: { ...board, board: newBoard },
      setupCandidates: null,
      setupError: '',
    })
  },

  setSetupTool: (tool) => set({ setupTool: tool }),

  setSetupTurn: (t) => set({ setupTurn: t, setupCandidates: null }),

  clearSetupBoard: () => {
    const { board } = get()
    set({
      board: { ...board, board: createEmptyBoard() },
      setupCandidates: null,
      setupError: '',
    })
  },

  resetSetupBoard: () => {
    const { board } = get()
    set({
      board: { ...boardFromFen(START_FEN), turn: board.turn },
      setupCandidates: null,
      setupError: '',
    })
  },

  /** 分析摆好的局面（多 PV 候选，计划第16节） */
  analyzeSetupPosition: async () => {
    const { engine, board, setupTurn } = get()
    if (!engine || !engine.isReady) return

    // 校验: 双方必须有将/帅
    let redKing = 0, blackKing = 0
    for (let c = 0; c < 9; c++) for (let r = 0; r < 10; r++) {
      if (board.board[c][r] === 'K') redKing++
      if (board.board[c][r] === 'k') blackKing++
    }
    if (redKing !== 1 || blackKing !== 1) {
      set({ setupError: '双方必须各有一个将/帅' })
      return
    }

    const fen = boardToFen({ ...board, turn: setupTurn })

    set({ isThinking: true, setupCandidates: null, setupError: '' })
    try {
      await engine.analyzeLines(fen, [], Math.min(get().engineDepth, 18), 3, (lines) => {
        set({
          setupCandidates: lines.map(l => ({ move: l.move, score: l.score, pv: l.pv })),
        })
      })
    } catch (e) {
      console.error('摆棋分析失败:', e)
      set({ setupError: '分析失败，请重试' })
    } finally {
      set({ isThinking: false })
    }
  },

  // ══════════════════════════════════════════════════════════════════
  // 错误重走 (计划第17节)
  // ══════════════════════════════════════════════════════════════════

  /** 从第 plyIndex 步（0-based）的失误局面开始重新挑战 */
  startPuzzle: (plyIndex) => {
    const { game, mode, timerInterval } = get()
    const ply = game.plies[plyIndex]
    if (!ply || !ply.analysis?.bestMove) return
    if (timerInterval) clearInterval(timerInterval)

    set({
      mode: 'puzzle',
      modeBeforeSetup: mode === 'puzzle' ? 'replay' : mode,
      timerInterval: null,
      puzzlePlyIndex: plyIndex,
      puzzleAttempts: 0,
      puzzleResult: 'waiting',
      puzzleRevealed: false,
      board: boardFromGame(game, plyIndex), // 决策局面（失误那步之前）
      currentPlyIndex: plyIndex,
      selected: null,
      legalTargets: [],
      lastMove: plyIndex > 0
        ? parseMoveFromUci(game.plies[plyIndex - 1].move, game.plies[plyIndex - 1].turn)
        : null,
    })
  },

  exitPuzzle: () => {
    const { game, currentPlyIndex } = get()
    set({
      mode: 'replay',
      board: boardFromGame(game, currentPlyIndex),
      puzzlePlyIndex: null,
      puzzleResult: 'waiting',
      puzzleRevealed: false,
      selected: null,
      legalTargets: [],
    })
  },

  /** 重走尝试: 命中最佳着法 → 正确；否则提示再想想（不落子） */
  puzzleTryMove: (from, to) => {
    const { game, puzzlePlyIndex, puzzleAttempts } = get()
    if (puzzlePlyIndex === null) return false

    const expected = game.plies[puzzlePlyIndex].analysis?.bestMove
    if (!expected) return false

    const uci = `${String.fromCharCode(97 + from.col)}${from.row}${String.fromCharCode(97 + to.col)}${to.row}`
    set({ selected: null, legalTargets: [] })

    if (uci === expected) {
      // 正确: 在棋盘上演示最佳着法
      const st = boardFromGame(game, puzzlePlyIndex)
      const newState = makeMove(st, { from, to, turn: st.turn })
      set({
        puzzleResult: 'correct',
        board: newState,
        lastMove: { from, to, turn: st.turn },
      })
    } else {
      set({ puzzleResult: 'wrong', puzzleAttempts: puzzleAttempts + 1 })
    }
    return true
  },

  revealPuzzleAnswer: () => set({ puzzleRevealed: true }),

  /** 错题本入口: 载入对应棋谱后进入重走模式 */
  startPuzzleFromGame: (gameId, plyIndex) => {
    const g = getAllGames().find(x => x.id === gameId)
    if (!g || !g.plies[plyIndex]?.analysis?.bestMove) return

    // 先以 replay 形式载入该棋谱（退出重走时回到它的复盘）
    set({
      game: g,
      mode: 'replay',
      currentPlyIndex: plyIndex,
    })
    get().startPuzzle(plyIndex)
  },

  /** 残局训练: 自定义起始局面，玩家执红先行 */
  startEndgameTraining: (fen, name) => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)

    const game = createEmptyGame()
    game.startFen = fen
    game.header.Event = '残局训练'
    game.header.Red = '玩家'
    game.header.Black = name

    set({
      mode: 'play',
      game,
      board: boardFromFen(fen),
      playerSide: 'w',
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
      analysis: null,
      redTime: 0,
      blackTime: 0,
      puzzlePlyIndex: null,
    })

    const interval = setInterval(() => {
      const { mode, board, redTime, blackTime } = get()
      if (mode !== 'play') return
      if (board.turn === 'w') {
        set({ redTime: redTime + 100 })
      } else {
        set({ blackTime: blackTime + 100 })
      }
    }, 100)
    set({ timerInterval: interval })
  },
}))

// ── 辅助函数 ──────────────────────────────────────────────────────

function parseMoveFromUci(uci: string, turn: Turn): Move {
  return {
    from: { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) },
    to: { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) },
    turn,
  }
}

/** 根据走法损失（厘兵）分类走法质量 */
function classifyMove(moveLoss: number): PlyAnalysis['classification'] {
  if (moveLoss === 0) return 'best'
  if (moveLoss < 10) return 'excellent'  // < 0.1兵
  if (moveLoss < 30) return 'good'       // < 0.3兵
  if (moveLoss < 80) return 'inaccuracy' // < 0.8兵
  if (moveLoss < 150) return 'mistake'   // < 1.5兵
  if (moveLoss < 300) return 'blunder'   // < 3兵
  return 'blunder2'                       // >= 3兵
}


