/**
 * AppState 类型定义（自 useStore.ts 拆出）
 */
import type { BoardState, Move, Pos, Turn } from '../game/board'
import type { Game } from '../game/model'
import type { AppSettings } from '../game/storage'
import type { RatingChange } from '../game/rating'
import type { PikafishEngine } from '../engine/pikafish'

export type LastRatingChange = RatingChange

// ── 类型定义 ──────────────────────────────────────────────────────

export type GameMode = 'play' | 'replay' | 'analysis' | 'puzzle' | 'setup'
export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'master' | 'grandmaster'
export type TabType = 'play' | 'games' | 'analysis' | 'settings'

/** 对局角色：每方由谁控制（玩家 / AI） */
export type Controller = 'human' | 'ai'
export interface SideControl { w: Controller; b: Controller }

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

export interface AppState {
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
  /** 对局角色：每方控制者。单人机时与 playerSide 一致；双人为双 human；AI 演示为双 ai */
  sideControl: SideControl
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
  /** 移动端覆盖层（全屏面板）key：底部 Tab 或特殊模式（setup/puzzle/quiz/opening/variation/controls）；null 时为纯棋盘主页 */
  sheetTab: string | null
  setSheetTab: (tab: string | null) => void
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
  startNewGame: (difficulty: Difficulty, playerSide: Turn, control?: SideControl) => void
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

/** slice 组合用 set/get 签名 */
export type StoreSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
export type StoreGet = () => AppState

export type { BoardState, Move, Pos, Turn } from '../game/board'
