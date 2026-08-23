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
  makeMove, boardToFen,
  boardFromFen, createEmptyBoard, START_FEN,
} from '../game/board'
import type { Move, Pos, Turn } from '../game/board'
import {
  getLegalMoves, getGameStatus, isInCheck, getAllLegalMoves, chineseFromFen, pvToChinese,
} from '../game/rules'
import type { Game, Ply, PlyAnalysis } from '../game/model'
import {
  createEmptyGame, addPlyToGame, getStateAtPly, getFenSequence,
} from '../game/model'
import { parsePGN, exportPGN } from '../game/pgn'
import {
  saveGame as storageSaveGame, getAllGames, getSettings, saveSettings,
  deleteGame as storageDeleteGame, initGameStorage,
  getQuizStats, saveQuizStats, addQuizMistake, removeQuizMistake,
  getMasterAnalysis, putMasterAnalysis,
  MASTER_ANALYSIS_FMT, type MasterAnalysisRecord,
} from '../game/storage'
import type { AppSettings } from '../game/storage'
import { PikafishEngine } from '../engine/pikafish'
import { pickBestKeyPly, engineEvalOnce, JUDGE_MIN_DEPTH } from '../game/masterPreanalysis'
import { getBookMove, loadOpeningBook } from '../game/book'
import { OPENING_LINES } from '../game/openings'
import { getCachedLibrary, recordToGame } from '../game/masterLibrary'
import { playMoveSound, playCaptureSound, playCheckSound, resumeAudio, playMoveHaptic, playCheckHaptic, playGameOverHaptic } from '../game/sound'
import { applyGameResult } from '../game/rating'
import type { RatingChange } from '../game/rating'

/** 终局结算的棋力分变化（结果页展示） */
export type LastRatingChange = RatingChange

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

  /** 局面评估条（对战页棋盘上方，分数为行棋方视角） */
  evalBar: { score: number; fen: string } | null
  /** 轮到玩家且引擎空闲时快速评估当前局面 */
  quickEval: () => Promise<void>

  // ── 对局状态 ──
  mode: GameMode
  game: Game
  /** 当前棋盘状态 (由 game 的 plies 重建) */
  board: BoardState
  difficulty: Difficulty
  playerSide: Turn
  boardFlipped: boolean
  /** 最近一局人机对局结算的棋力分变化 */
  lastRatingChange: LastRatingChange | null

  // ── 摆棋模式 (计划第16节) ──
  modeBeforeSetup: GameMode
  setupTool: SetupTool
  /** 摆棋局面的行棋方（分析用） */
  setupTurn: Turn
  /** 摆棋分析结果（多 PV 候选） */
  setupCandidates: CandidateLine[] | null
  setupError: string

  // ── 开局训练 (计划第22节) ──
  openingTraining: {
    lineId: string
    /** 已完成的 ply 数 */
    index: number
    status: 'playing' | 'wrong' | 'done'
  } | null

  /** 棋谱页子导航（供训练计划等外部跳转） */
  gamesSubTab: 'list' | 'library' | 'mistakes' | 'training'
  setGamesSubTab: (t: 'list' | 'library' | 'mistakes' | 'training') => void

  /** 应用设置（响应式：改皮肤/主题即时生效） */
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void

  /** 重放自动播放（提升到 store 以支持键盘快捷键） */
  autoPlaying: boolean
  setAutoPlaying: (v: boolean) => void

  // ── 错误重走 (计划第17节) ──
  /** 正在重走的 Ply 序号（0-based，决策局面 = 该步之前） */
  puzzlePlyIndex: number | null
  puzzleAttempts: number
  puzzleResult: 'waiting' | 'correct' | 'wrong'
  puzzleRevealed: boolean

  // ── 变化推演 (计划第15节) ──
  variation: {
    /** 推演起点局面（0-based ply 序号，棋盘处于该局面） */
    basePly: number
    /** PV 着法（UCI） */
    moves: string[]
    /** PV 中文记谱 */
    moveCns: string[]
    /** 当前推演到第几步（0..moves.length） */
    index: number
  } | null

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
  loadGameObject: (game: Game) => void
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
  /** 从某步的 PV 进入主变推演（计划第15节） */
  enterVariationFromPly: (plyIndex: number) => void
  /** 从当前单局面分析结果进入主变推演 */
  enterVariationFromLive: () => void
  /** 复盘中从当前局面开始试走变化 */
  startReplayVariation: () => void
  variationGo: (k: number) => void
  exitVariation: () => void
  /** 推演中在棋盘上落子（覆盖式改写后续分支） */
  variationTryMove: (from: Pos, to: Pos) => boolean
  /** 内部：在起点局面上应用前 k 步 PV */
  _applyVariation: (basePly: number, moves: string[], k: number) => BoardState
  // ── 名局拆解训练 ──
  masterQuiz: {
    /** 当前问题的 ply（0-based，问"这步怎么走"） */
    ply: number
    total: number
    options: string[]
    correct: string
    status: 'asking' | 'correct' | 'wrong'
    answered?: string
    asked: number
    right: number
    streak: number
    bestStreak: number
    /** 关键手模式：只在吃子/将军等着法上提问 */
    keyOnly: boolean
    /** 引擎正在判定玩家着法是否殊途同归 */
    checking?: boolean
    /** 引擎认可玩家的选择（与大师着法不同但同样好） */
    aiAgree?: boolean
  } | null
  startMasterQuiz: () => void
  answerMasterQuiz: (uci: string) => void
  nextQuizPly: () => void
  exitMasterQuiz: () => void
  toggleQuizKeyMode: () => void
  /** 从错题本跨棋谱发起重走 */
  startPuzzleFromGame: (gameId: string, plyIndex: number) => void
  /** 残局训练：以指定 FEN 开局，玩家执红 vs 引擎 */
  startEndgameTraining: (fen: string, name: string, side?: 'w' | 'b') => void
  /** 重演拆解错题局面（执提问方行棋 vs 引擎） */
  replayQuizMistake: (m: { fen: string; turn: 'w' | 'b' }) => void

  // ── 开局训练 (计划第22节) ──
  startOpeningTraining: (lineId: string) => void
  exitOpeningTraining: () => void
  openingTryMove: (from: Pos, to: Pos) => boolean

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

/**
 * 终局棋力分结算。
 * 难度取 header.Difficulty（v1.2 起写入）；
 * 旧棋谱按对手名回推；残局/导入等非人机对局返回 null 不计分。
 */
function settleRating(game: Game): LastRatingChange | null {
  const isRedPlayer = game.header.Red === '玩家'
  const isBlackPlayer = game.header.Black === '玩家'
  if (isRedPlayer === isBlackPlayer) return null

  let difficulty = game.header.Difficulty as Difficulty | undefined
  if (!difficulty || !(difficulty in DIFFICULTY_LABELS)) {
    const oppName = isRedPlayer ? game.header.Black : game.header.Red
    difficulty = (Object.entries(DIFFICULTY_LABELS) as [Difficulty, string][])
      .find(([, label]) => label === oppName)?.[0]
    if (!difficulty) return null
  }

  const outcome =
    game.result === '1/2-1/2' ? 'draw'
      : game.result === '1-0' ? (isRedPlayer ? 'win' : 'loss')
        : (isBlackPlayer ? 'win' : 'loss')

  return applyGameResult(game.id, difficulty, outcome)
}

// ── 辅助函数 ──────────────────────────────────────────────────────

function boardFromGame(game: Game, plyIndex: number): BoardState {
  if (plyIndex === 0) return boardFromFen(game.startFen)
  const state = getStateAtPly(game.startFen, game.plies, plyIndex)
  return state
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 名局拆解：为 ply 生成"猜着法"选项（1 正确 + 3 干扰项） */
function buildQuizOptions(game: Game, ply: number): { options: string[]; correct: string } {
  const fen = ply === 0 ? game.startFen : game.plies[ply - 1].fenAfter
  const state = boardFromFen(fen)
  const uciOf = (m: { from: Pos; to: Pos }) =>
    `${String.fromCharCode(97 + m.from.col)}${m.from.row}${String.fromCharCode(97 + m.to.col)}${m.to.row}`
  const correct = game.plies[ply].move
  const pool = getAllLegalMoves(state).map(uciOf).filter(u => u !== correct)
  // 洗牌取 3 个干扰项
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const options = [correct, ...pool.slice(0, 3)]
  // 选项顺序打乱
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return { options, correct }
}

/**
 * 当前拆解对局的预分析缓存（IDB 异步加载）。
 * 用于挑选"大师与引擎分歧最大"的关键手；id 校验防止换局后串用。
 */
let quizAnalysisRec: { id: string; rec: MasterAnalysisRecord | null } = { id: '', rec: null }

function quizCachedAnalysis(gameId: string): MasterAnalysisRecord | null {
  return quizAnalysisRec.id === gameId ? quizAnalysisRec.rec : null
}

function makeMasterQuizQuestion(
  game: Game,
  ply: number,
  prev?: { asked: number; right: number; streak: number; bestStreak: number; keyOnly: boolean },
): NonNullable<AppState['masterQuiz']> {
  const { options, correct } = buildQuizOptions(game, ply)
  // 战绩累计持久化：进行中从上一题续接，新会话从存档续接
  const saved = getQuizStats()
  return {
    ply,
    total: game.plies.length,
    options,
    correct,
    status: 'asking',
    asked: prev ? prev.asked : saved.asked,
    right: prev ? prev.right : saved.right,
    streak: prev?.streak ?? 0,
    bestStreak: Math.max(prev?.bestStreak ?? 0, saved.bestStreak),
    keyOnly: prev?.keyOnly ?? true,
  }
}

/**
 * 引擎判定拆解答案：玩家着法与大师不同但引擎同样推荐 → 改判正确（殊途同归）。
 * 优先查预分析缓存（即时且深度更高）；无缓存回退实时 depth 10，
 * 并把结果写透缓存供下次复用。仅在问题未变化时生效。
 */
async function judgeQuizAlternative(uci: string): Promise<void> {
  const s = useStore.getState()
  const quiz = s.masterQuiz
  if (!quiz) return
  const game = s.game

  // ── 快速路径：预分析缓存命中 → 即时判定，不再占用引擎 ──
  const rec = await getMasterAnalysis(game.id)
  const ev = rec && rec.fmt === MASTER_ANALYSIS_FMT ? rec.evals[quiz.ply] : undefined
  if (ev && ev.depth >= JUDGE_MIN_DEPTH) {
    if (ev.bestMove === uci) await applyQuizAiAgree(quiz)
    return
  }

  // ── 回退：实时引擎判定（原有路径）──
  if (!s.engine || !s.engineReady || s.isThinking) return
  useStore.setState({ masterQuiz: { ...quiz, checking: true } })
  try {
    const fen = quiz.ply === 0 ? game.startFen : game.plies[quiz.ply].fenBefore
    const evLive = await engineEvalOnce(s.engine, fen, 10)
    if (evLive && evLive.bestMove === uci) {
      await applyQuizAiAgree(quiz)
      // 写透缓存：下次同局面即时判定（仅大师局）
      if (game.id.startsWith('dpxq_')) {
        void putMasterAnalysis({
          gameId: game.id,
          fmt: MASTER_ANALYSIS_FMT,
          depth: evLive.depth,
          createdAt: Date.now(),
          evals: { ...rec?.evals, [quiz.ply]: evLive },
        })
      }
    }
  } catch { /* 引擎不可用时静默跳过 */ } finally {
    const q = useStore.getState().masterQuiz
    if (q?.checking) useStore.setState({ masterQuiz: { ...q, checking: false } })
  }
}

/** 追认玩家答案为正确（殊途同归）：战绩回滚 + 移除错题；问题已切走则忽略 */
async function applyQuizAiAgree(snapshot: NonNullable<AppState['masterQuiz']>): Promise<void> {
  const q = useStore.getState().masterQuiz
  // 问题已切走则不追认
  if (!q || q.ply !== snapshot.ply || q.status !== 'wrong' || q.answered !== snapshot.answered) return
  useStore.setState({
    masterQuiz: {
      ...q,
      status: 'correct',
      aiAgree: true,
      right: q.right + 1,
      streak: q.streak + 1,
      bestStreak: Math.max(q.bestStreak, q.streak + 1),
    },
  })
  saveQuizStats({ asked: q.asked, right: q.right + 1, bestStreak: Math.max(q.bestStreak, q.streak + 1) })
  const game = useStore.getState().game
  const fen = snapshot.ply === 0 ? game.startFen : game.plies[snapshot.ply].fenBefore
  removeQuizMistake(fen, snapshot.correct)
}

/** toast 自动消失定时器 */
let toastTimer: ReturnType<typeof setTimeout> | null = null

/** 整盘分析取消标记 */
let analysisCancelFlag = false

// ── Store ─────────────────────────────────────────────────────────

export const useStore = create<AppState>((set, get) => ({
  // ── 名局拆解 ──
  masterQuiz: null,

  // ── 引擎 ──
  engine: null,
  engineReady: false,
  isThinking: false,
  engineDepth: 10,
  analysis: null,
  hintInfo: null,
  analysisProgress: null,
  evalBar: null,

  // ── 对局状态 ──
  mode: 'play',
  game: createEmptyGame(),
  board: boardFromFen(START_FEN),
  difficulty: 'medium',
  playerSide: 'w',
  boardFlipped: false,
  lastRatingChange: null,

  // ── 摆棋模式 ──
  modeBeforeSetup: 'play',
  setupTool: { kind: 'erase' },
  setupTurn: 'w',
  setupCandidates: null,
  setupError: '',

  // ── 开局训练 ──
  openingTraining: null,

  // ── 棋谱页子导航 ──
  gamesSubTab: 'list',
  setGamesSubTab: (t) => set({ gamesSubTab: t }),

  // ── 重放自动播放 ──
  autoPlaying: false,
  setAutoPlaying: (v) => set({ autoPlaying: v }),

  // ── 设置 ──
  settings: getSettings(),
  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    saveSettings(next)
    set({ settings: next })
  },

  // ── 错误重走 ──
  puzzlePlyIndex: null,
  puzzleAttempts: 0,
  puzzleResult: 'waiting',
  puzzleRevealed: false,

  // ── 变化推演 ──
  variation: null,

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
    // 先载入棋谱存储（IndexedDB → 内存镜像）
    try {
      await initGameStorage()
    } catch (e) {
      console.error('棋谱存储初始化失败:', e)
    }
    set({ savedGames: getAllGames() })
    // 大数据开局书后台加载（未就绪时 AI 用内置定式兜底）
    loadOpeningBook()
    const engine = new PikafishEngine({ depth: DIFFICULTY_DEPTH.medium })
    try {
      await engine.init()
      set({ engine, engineReady: true })
    } catch (e) {
      console.error('引擎初始化失败:', e)
    }
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
    game.header.Difficulty = difficulty

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
      lastRatingChange: null,
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
    // 推演模式下允许在棋盘上试走变化
    if (mode !== 'play' && mode !== 'puzzle' && !(mode === 'replay' && state.variation)) return

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
    // 开局训练模式: 只校验理论着法，不落子到棋谱
    if (mode === 'play' && get().openingTraining) return get().openingTryMove(from, to)
    // 变化推演中: 落子写入分支
    if (get().variation) return get().variationTryMove(from, to)
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

    // 音效 + 触感
    const settings = getSettings()
    const captured = board.board[to.col][to.row] !== '.'
    if (captured) {
      playCaptureSound(settings.soundCapture)
    } else {
      playMoveSound(settings.soundMove)
    }
    if (status.inCheck) {
      playCheckSound(settings.soundCheck)
      playCheckHaptic(settings.hapticEnabled)
    } else {
      playMoveHaptic(settings.hapticEnabled)
    }

    // 对局结束
    if (status.isGameOver) {
      const { timerInterval } = get()
      if (timerInterval) clearInterval(timerInterval)
      set({ timerInterval: null })
      playGameOverHaptic(settings.hapticEnabled)
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
    if (get().openingTraining) return // 开局训练中不可悔棋
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
    } else {
      setTimeout(() => { if (get().settings.autoEval !== false) get().quickEval() }, 150)
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

      // 开局库优先（计划外增强: 提升开局质量与多样性）
      let bestUci: string | null = null
      const bookMove = getBookMove(moveList)
      if (bookMove) {
        const legal = getAllLegalMoves(currentBoard)
        const bf = { col: bookMove.charCodeAt(0) - 97, row: parseInt(bookMove[1]) }
        const bt = { col: bookMove.charCodeAt(2) - 97, row: parseInt(bookMove[3]) }
        if (legal.some(m => m.from.col === bf.col && m.from.row === bf.row && m.to.col === bt.col && m.to.row === bt.row)) {
          bestUci = bookMove
        }
      }

      if (!bestUci) {
        bestUci = await engine.go(fen, moveList, engineDepth)
      }

      if (bestUci && bestUci !== '(none)' && bestUci.length >= 4) {
        const from = { col: bestUci.charCodeAt(0) - 97, row: parseInt(bestUci[1]) }
        const to = { col: bestUci.charCodeAt(2) - 97, row: parseInt(bestUci[3]) }
        get().tryMove(from, to)
      }
    } catch (e) {
      console.error('AI 走棋失败:', e)
    } finally {
      set({ isThinking: false })
      // AI 走完轮到玩家，自动评估局面供评估条显示
      setTimeout(() => { if (get().settings.autoEval !== false) get().quickEval() }, 120)
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

    // 棋力分结算（计划19节 V3: 仅人机对局终局，同局去重）
    if (game.result !== '*') {
      const change = settleRating(game)
      if (change) set({ lastRatingChange: change })
    }

    const ok = storageSaveGame(game)
    if (!ok) {
      get().showToast('⚠ 保存失败：存储空间已满，请在棋谱页备份或删除旧棋谱')
    }
    set({ savedGames: getAllGames() })
  },

  loadGame: (id) => {
    const games = getAllGames()
    const game = games.find(g => g.id === id)
    if (!game) return
    get().loadGameObject(game)
  },

  /** 直接载入一个未入存储的棋谱（大师库浏览用，不写 localStorage） */
  loadGameObject: (game) => {
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

  /** 快速评估当前局面（轮到玩家时自动触发，供评估条显示） */
  quickEval: async () => {
    const s = get()
    if (!s.engine?.isReady || s.isThinking) return
    if (s.mode !== 'play' || s.openingTraining || s.game.result !== '*') return
    const board = boardFromGame(s.game, s.game.plies.length)
    if (board.turn !== s.playerSide) return // 只在玩家回合评估

    const fen = boardToFen(board)
    try {
      await s.engine.analyze(fen, s.game.plies.map(p => p.move), Math.min(getSettings().analysisDepth, 12), (info) => {
        set({
          analysis: {
            depth: info.depth,
            score: info.score,
            bestMove: info.move,
            pv: info.pv,
            fen,
          },
          evalBar: { score: info.score, fen },
        })
      })
    } catch {}
  },

  analyzePosition: async () => {
    const { game, engine, currentPlyIndex } = get()
    if (!engine || !engine.isReady) return

    const currentBoard = boardFromGame(game, currentPlyIndex)
    const fen = boardToFen(currentBoard)

    set({ isThinking: true })
    try {
      // 单局面分析用设置的分析深度（比整盘更深，只搜一个局面）
      await engine.analyze(fen, game.plies.slice(0, currentPlyIndex).map(p => p.move), getSettings().analysisDepth + 4, (info) => {
        set({
          analysis: {
            depth: info.depth,
            score: info.score,
            bestMove: info.move,
            pv: info.pv,
            fen,
          },
          evalBar: { score: info.score, fen },
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

    // 整盘分析深度取设置档位（计划9.1: 快速/标准/深度）
    const depth = Math.min(getSettings().analysisDepth, 16)
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
    // 清空但保留双方将/帅（分析必需）
    const empty = createEmptyBoard()
    empty[4][0] = 'K'
    empty[4][9] = 'k'
    set({
      board: { ...board, board: empty },
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
  startEndgameTraining: (fen, name, side = 'w') => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)

    const game = createEmptyGame()
    game.startFen = fen
    game.header.Event = side === 'w' ? '残局训练' : '残局训练（执黑）'
    game.header.Red = side === 'w' ? '玩家' : name
    game.header.Black = side === 'b' ? '玩家' : name

    set({
      mode: 'play',
      game,
      board: boardFromFen(fen),
      playerSide: side,
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

  // ══════════════════════════════════════════════════════════════════
  // 变化推演 (计划第15节)
  // ══════════════════════════════════════════════════════════════════

  /** 重演拆解错题：退出拆解，从提问局面执原行棋方 vs 引擎 */
  replayQuizMistake: (m) => {
    set({ masterQuiz: null })
    get().startEndgameTraining(m.fen, '错题重演', m.turn)
  },

  /** 在 base 局面上应用前 k 步 PV */
  _applyVariation: (basePly: number, moves: string[], k: number): BoardState => {
    const { game } = get()
    let st = boardFromGame(game, basePly)
    for (let i = 0; i < k && i < moves.length; i++) {
      const u = moves[i]
      st = makeMove(st, {
        from: { col: u.charCodeAt(0) - 97, row: parseInt(u[1]) },
        to: { col: u.charCodeAt(2) - 97, row: parseInt(u[3]) },
        turn: st.turn,
      })
    }
    return st
  },

  enterVariationFromPly: (plyIndex) => {
    const { game } = get()
    const ply = game.plies[plyIndex]
    const pv = ply?.analysis?.pv
    if (!pv || pv.length === 0) return

    const moves = pv.slice(0, 10)
    set({
      variation: {
        basePly: plyIndex,
        moves,
        moveCns: pvToChinese(ply.fenBefore, moves, 10),
        index: 0,
      },
      board: boardFromGame(game, plyIndex),
      selected: null,
      legalTargets: [],
      lastMove: null,
    })
  },

  enterVariationFromLive: () => {
    const { analysis, currentPlyIndex, game } = get()
    if (!analysis || analysis.pv.length === 0) return

    const moves = analysis.pv.slice(0, 10)
    set({
      variation: {
        basePly: currentPlyIndex,
        moves,
        moveCns: pvToChinese(analysis.fen, moves, 10),
        index: 0,
      },
      board: boardFromGame(game, currentPlyIndex),
      selected: null,
      legalTargets: [],
      lastMove: null,
    })
  },

  /** 复盘：从当前局面开始自由试走变化 */
  startReplayVariation: () => {
    const { mode, currentPlyIndex } = get()
    if (mode !== 'replay') return
    set({
      variation: {
        basePly: currentPlyIndex,
        moves: [],
        moveCns: [],
        index: 0,
      },
      selected: null,
      legalTargets: [],
    })
  },

  variationGo: (k) => {
    const { variation } = get()
    if (!variation) return
    const index = Math.max(0, Math.min(k, variation.moves.length))
    const apply = get() as any
    const st = apply._applyVariation(variation.basePly, variation.moves, index)
    const lastUci = index > 0 ? variation.moves[index - 1] : null
    set({
      variation: { ...variation, index },
      board: st,
      lastMove: lastUci
        ? {
            from: { col: lastUci.charCodeAt(0) - 97, row: parseInt(lastUci[1]) },
            to: { col: lastUci.charCodeAt(2) - 97, row: parseInt(lastUci[3]) },
            turn: st.turn === 'w' ? 'b' : 'w',
          }
        : null,
    })
  },

  exitVariation: () => {
    const { game, currentPlyIndex } = get()
    set({
      variation: null,
      board: boardFromGame(game, currentPlyIndex),
      lastMove: currentPlyIndex > 0
        ? parseMoveFromUci(game.plies[currentPlyIndex - 1].move, game.plies[currentPlyIndex - 1].turn)
        : null,
    })
  },

  /** 推演中在棋盘上落子：校验合法性 → 写入分支 → 前进 */
  variationTryMove: (from, to) => {
    const { board, variation } = get()
    if (!variation) return false

    const legalMoves = getLegalMoves(board, from.col, from.row)
    if (!legalMoves.some(m => m.col === to.col && m.row === to.row)) {
      set({ selected: null, legalTargets: [] })
      return false
    }

    // 覆盖式改写：回退后落子将截断后续着法（分支树语义）
    const uci = `${String.fromCharCode(97 + from.col)}${from.row}${String.fromCharCode(97 + to.col)}${to.row}`
    const moves = [...variation.moves.slice(0, variation.index), uci]

    // 从起点局面重算中文记谱
    const baseFen = boardToFen(boardFromGame(get().game, variation.basePly))
    const moveCns = pvToChinese(baseFen, moves)

    set({ variation: { ...variation, moves, moveCns } })
    get().variationGo(variation.index + 1)

    // 音效反馈
    const settings = getSettings()
    const captured = board.board[to.col][to.row] !== '.'
    if (captured) playCaptureSound(settings.soundCapture)
    else playMoveSound(settings.soundMove)
    return true
  },

  // ══════════════════════════════════════════════════════════════════
  // 名局拆解训练：猜大师的着法
  // ══════════════════════════════════════════════════════════════════

  startMasterQuiz: async () => {
    const games = getCachedLibrary()
    if (!games || games.length === 0) {
      get().showToast('大师库尚未加载，请先打开「大师库」页签')
      return
    }
    const pool = games.filter(g => g.mv.length / 4 >= 40)
    if (pool.length === 0) {
      get().showToast('⚠ 棋谱库为空')
      return
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = pool[Math.floor(Math.random() * pool.length)]
      const game = recordToGame(rec)
      if (!game || game.plies.length < 40) continue
      get().loadGameObject(game)
      // 预取该局预分析缓存，关键手优先问"大师与引擎分歧最大"处
      quizAnalysisRec = { id: game.id, rec: await getMasterAnalysis(game.id) }
      // 关键手模式从第一个高价值关键点开始；全程模式从第 0 手开始
      const startPly = pickBestKeyPly(game, 0, quizAnalysisRec.rec)
      const quizPly = startPly >= 0 ? startPly : 0
      get().goToPly(quizPly)
      set({ masterQuiz: makeMasterQuizQuestion(game, quizPly) })
      return
    }
    get().showToast('⚠ 未能生成拆解对局，请重试')
  },

  answerMasterQuiz: (uci) => {
    const quiz = get().masterQuiz
    if (!quiz || quiz.status !== 'asking') return
    const correct = uci === quiz.correct
    set({
      masterQuiz: {
        ...quiz,
        status: correct ? 'correct' : 'wrong',
        answered: uci,
        aiAgree: undefined,
        asked: quiz.asked + 1,
        right: quiz.right + (correct ? 1 : 0),
        streak: correct ? quiz.streak + 1 : 0,
        bestStreak: Math.max(quiz.bestStreak, correct ? quiz.streak + 1 : 0),
      },
    })
    // 持久化累计战绩
    const q = get().masterQuiz!
    saveQuizStats({ asked: q.asked, right: q.right, bestStreak: q.bestStreak })
    // 答错记入拆解错题本
    if (!correct) {
      const game = get().game
      const fen = quiz.ply === 0 ? game.startFen : game.plies[quiz.ply].fenBefore
      addQuizMistake({
        fen,
        turn: boardFromFen(fen).turn,
        playerUci: uci,
        masterUci: quiz.correct,
        masterMoveCn: chineseFromFen(fen, quiz.correct),
        date: Date.now(),
      })
      void judgeQuizAlternative(uci)
    }
    // 展示大师的实际着法
    get().goToPly(quiz.ply + 1)
  },

  nextQuizPly: () => {
    const { masterQuiz, game } = get()
    if (!masterQuiz) return
    let nextPly = masterQuiz.ply + 1
    // 关键手模式跳到下一个吃子/将军点（有缓存时优先分歧最大处）
    if (masterQuiz.keyOnly && nextPly < game.plies.length) {
      const keyPly = pickBestKeyPly(game, nextPly, quizCachedAnalysis(game.id))
      if (keyPly >= 0) nextPly = keyPly
    }
    if (nextPly >= game.plies.length) {
      set({ masterQuiz: { ...masterQuiz, ply: nextPly, options: [], correct: '' } })
      return
    }
    set({
      masterQuiz: makeMasterQuizQuestion(game, nextPly, {
        asked: masterQuiz.asked,
        right: masterQuiz.right,
        streak: masterQuiz.streak,
        bestStreak: masterQuiz.bestStreak,
        keyOnly: masterQuiz.keyOnly,
      }),
    })
    get().goToPly(nextPly)
  },

  exitMasterQuiz: () => {
    set({ masterQuiz: null })
  },

  toggleQuizKeyMode: () => {
    const { masterQuiz } = get()
    if (!masterQuiz) return
    set({ masterQuiz: { ...masterQuiz, keyOnly: !masterQuiz.keyOnly } })
  },

  // ══════════════════════════════════════════════════════════════════
  // 开局训练 (计划第22节"开局训练")
  // ══════════════════════════════════════════════════════════════════

  startOpeningTraining: (lineId) => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)

    set({
      mode: 'play',
      openingTraining: { lineId, index: 0, status: 'playing' },
      game: createEmptyGame(),
      board: boardFromFen(START_FEN),
      playerSide: 'w',
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
      analysis: null,
      hintInfo: null,
      puzzlePlyIndex: null,
      redTime: 0,
      blackTime: 0,
      activeTab: 'play',
    })
  },

  exitOpeningTraining: () => {
    set({ openingTraining: null })
    get().restart() // 回到普通对局
  },

  /** 训练走子校验: 对理论着法，错则提示不落子 */
  openingTryMove: (from, to) => {
    const ot = get().openingTraining
    if (!ot) return false
    const line = OPENING_LINES.find(l => l.id === ot.lineId)
    if (!line || ot.index >= line.moves.length) return false

    const uci = `${String.fromCharCode(97 + from.col)}${from.row}${String.fromCharCode(97 + to.col)}${to.row}`

    if (uci !== line.moves[ot.index]) {
      set({ openingTraining: { ...ot, status: 'wrong' } })
      return true
    }

    // 正确: 演示到棋盘
    const before = get().board
    const st = makeMove(before, { from, to, turn: before.turn })
    const idx = ot.index + 1

    set({
      openingTraining: { ...ot, index: idx, status: 'playing' },
      board: st,
      lastMove: { from, to, turn: before.turn },
      selected: null,
      legalTargets: [],
    })

    // 对手一侧自动按理论行棋
    if (idx < line.moves.length) {
      setTimeout(() => {
        const s2 = get()
        const ot2 = s2.openingTraining
        if (!ot2 || ot2.lineId !== ot.lineId || ot2.index !== idx) return
        const oppUci = line.moves[idx]
        const ob = s2.board
        const oppFrom = { col: oppUci.charCodeAt(0) - 97, row: parseInt(oppUci[1]) }
        const oppTo = { col: oppUci.charCodeAt(2) - 97, row: parseInt(oppUci[3]) }
        const st2 = makeMove(ob, { from: oppFrom, to: oppTo, turn: ob.turn })
        const done = idx + 1 >= line.moves.length
        set({
          openingTraining: { ...ot2, index: idx + 1, status: done ? 'done' : 'playing' },
          board: st2,
          lastMove: { from: oppFrom, to: oppTo, turn: ob.turn },
        })
        if (done) get().showToast('🎉 定式走完！你已掌握这条开局')
      }, 600)
    } else {
      get().showToast('🎉 定式走完！你已掌握这条开局')
      set({ openingTraining: { ...get().openingTraining!, status: 'done' } })
    }
    return true
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


