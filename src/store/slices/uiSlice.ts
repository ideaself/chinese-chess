/**
 * UI 状态/设置/导航 slice
 */
import type { AppState, StoreSet, StoreGet } from '../types'
import type { BoardState, Move, Pos, Turn, GameMode } from '../types'
import type { Game } from '../../game/model'
import { makeMove, boardFromFen, boardToFen, createEmptyBoard, START_FEN } from '../../game/board'
import { getLegalMoves, getAllLegalMoves, getGameStatus, chineseFromFen, pvToChinese } from '../../game/rules'
import { createEmptyGame, addPlyToGame, getFenSequence } from '../../game/model'
import { parsePGN, exportPGN } from '../../game/pgn'
import {
  saveGame as storageSaveGame, getAllGames, getSettings, saveSettings,
  deleteGame as storageDeleteGame, initGameStorage,
  getQuizStats, saveQuizStats, addQuizMistake, removeQuizMistake,
  getMasterAnalysis, putMasterAnalysis, MASTER_ANALYSIS_FMT,
} from '../../game/storage'
import type { MasterAnalysisRecord } from '../../game/storage'
import { PikafishEngine } from '../../engine/pikafish'
import { DIFFICULTY_DEPTH, DIFFICULTY_LABELS } from '../constants'
import { settleRating, boardFromGame, generateId, parseMoveFromUci } from '../helpers'
import {
  pickBestKeyPly, engineEvalOnce, JUDGE_MIN_DEPTH, classifyMove,
  applyCachedAnalysis, warmupGame, cancelWarmup,
  acquireEngineSlot, releaseEngineSlot,
} from '../../game/masterPreanalysis'
import { getBookMove, loadOpeningBook } from '../../game/book'
import { OPENING_LINES } from '../../game/openings'
import { getCachedLibrary, recordToGame } from '../../game/masterLibrary'
import { playMoveSound, playCaptureSound, playCheckSound, playCheckHaptic, playMoveHaptic, playGameOverHaptic, resumeAudio } from '../../game/sound'
import { BOARD_HOME } from '../constants'
import { consumeTopBackHandler, ensurePlaceholder, exitAppNative } from '../../game/backNav'


/** toast 自动消失定时器 */
let toastTimer: ReturnType<typeof setTimeout> | null = null

/** 根层最近一次按返回的时间（双击再退出） */
let lastRootBackAt = 0


export type MobilePage = 'home' | 'play' | 'games' | 'settings'

export function createUiSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'activeTab' | 'sheetTab' | 'setSheetTab' | 'toast' | 'showToast' | 'gamesSubTab' | 'setGamesSubTab' | 'settings' | 'updateSettings' | 'setTab' | 'navigateBack' | 'selfAnalysis' | 'setSelfAnalysis' | 'mobilePage' | 'setMobilePage'> {
  return {
    activeTab: 'play',

    mobilePage: 'home',

    setMobilePage: (p) => set({ mobilePage: p }),

    sheetTab: null,

    setSheetTab: (t) => set({ sheetTab: t }),

    selfAnalysis: false,

    setSelfAnalysis: (v) => set({ selfAnalysis: v }),

    toast: null,

    showToast: (msg) => {
    set({ toast: msg })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 4000)
  },

  // ── 对局控制 ──

    gamesSubTab: 'list',

    setGamesSubTab: (t) => set({ gamesSubTab: t }),

  // ── 重放自动播放 ──

    settings: getSettings(),

    updateSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    saveSettings(next)
    set({ settings: next })
  },

  // ── 错误重走 ──

    setTab: (tab) => set({ activeTab: tab }),

  // ── 层级返回（安卓返回手势/按键、页头「←」统一入口）──

    navigateBack: () => {
    const st = get()

    // ── 移动端层级导航 ──
    if (st.mobilePage !== undefined) {
      // 1) 面板内子级页（棋手页/筛选等自注册层）优先消费
      if (consumeTopBackHandler()) {
        ensurePlaceholder(true)
        return
      }
      // 2) 分支推演
      if (st.variation) { get().exitVariation(); return }
      // 3) 特殊模式层：摆棋 / 错题 / 拆解 / 开局训练
      if (st.mode === 'setup') { get().exitSetup(); return }
      if (st.mode === 'puzzle') { get().exitPuzzle(); return }
      if (st.masterQuiz) { get().exitMasterQuiz(); return }
      if (st.openingTraining) { get().exitOpeningTraining(); return }
      // 4) 打开的覆盖层面板 → 回纯棋盘主页
      if (st.sheetTab !== null && st.sheetTab !== BOARD_HOME) { get().setSheetTab(BOARD_HOME); return }
      // 4.5) 复盘模式 → 退出复盘
      if (st.mode === 'replay') {
        get().restart()
        // 从棋谱页进的复盘 → 回到棋谱列表；其他场景 → 回对战页
        const backTo = st.mobilePage === 'games' ? 'games' : 'play'
        set({ mobilePage: backTo, sheetTab: BOARD_HOME })
        return
      }
      // 5) 非首页 → 回首页
      if (st.mobilePage !== 'home') {
        set({ mobilePage: 'home' })
        return
      }
      // 6) 根层：2 秒内再按一次才退出
      const now = Date.now()
      if (now - lastRootBackAt < 2000) { exitAppNative() }
      else { lastRootBackAt = now; get().showToast('再按一次退出') }
      return
    }

    // ── 桌面端层级导航（保持原逻辑） ──
    // 1) 面板内子级页（棋手页/筛选等自注册层）优先消费
    if (consumeTopBackHandler()) {
      const layered = (st.sheetTab !== null && st.sheetTab !== BOARD_HOME)
        || st.mode === 'setup' || st.mode === 'puzzle'
        || st.masterQuiz !== null || st.openingTraining !== null || st.variation !== null
      ensurePlaceholder(layered)
      return
    }
    // 2) 分支推演
    if (st.variation) { get().exitVariation(); get().setSheetTab(BOARD_HOME); return }
    // 3) 特殊模式层：摆棋 / 错题 / 拆解 / 开局训练
    if (st.mode === 'setup') { get().exitSetup(); return }
    if (st.mode === 'puzzle') { get().exitPuzzle(); return }
    if (st.masterQuiz) { get().exitMasterQuiz(); return }
    if (st.openingTraining) { get().exitOpeningTraining(); return }
    // 4) 打开的覆盖层面板 → 回纯棋盘主页
    if (st.sheetTab !== null && st.sheetTab !== BOARD_HOME) { get().setSheetTab(BOARD_HOME); return }
    // 4.5) 复盘模式 → 退出复盘，回到可下棋的对战棋盘
    if (st.mode === 'replay') {
      get().restart()
      get().setTab('play')
      get().setSheetTab(BOARD_HOME)
      return
    }
    // 5) 非「对战」标签 → 棋盘主页
    if (st.activeTab !== 'play') { get().setTab('play'); get().setSheetTab(BOARD_HOME); return }
    // 6) 根层：2 秒内再按一次才退出
    const now = Date.now()
    if (now - lastRootBackAt < 2000) { exitAppNative() }
    else { lastRootBackAt = now; get().showToast('再按一次退出') }
  },
  }
}
