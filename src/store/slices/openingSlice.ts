/**
 * 开局训练 slice
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



export function createOpeningSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'openingTraining' | 'startOpeningTraining' | 'exitOpeningTraining' | 'openingTryMove'> {
  return {
    openingTraining: null,

  // ── 棋谱页子导航 ──

    startOpeningTraining: (lineId) => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)
    const replayOrigin = get().mobilePage
    const replayOriginTab = get().activeTab

    set({
      mode: 'play',
      openingTraining: { lineId, index: 0, status: 'playing' },
      game: createEmptyGame(),
      board: boardFromFen(START_FEN),
      playerSide: 'w',
      sideControl: { w: 'human', b: 'ai' },
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
      // 移动端多层导航：开局训练切换到对战页
      mobilePage: 'play' as const,
      replayOrigin,
      replayOriginTab,
    })
  },

    exitOpeningTraining: () => {
    const { replayOrigin, replayOriginTab } = get()
    set({
      openingTraining: null,
      activeTab: replayOriginTab ?? 'play',
      mobilePage: replayOrigin ?? 'play',
      replayOrigin: null,
      replayOriginTab: null,
    })
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
  }
}
