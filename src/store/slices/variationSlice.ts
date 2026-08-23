/**
 * 变化推演 slice
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



export function createVariationSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'variation' | '_applyVariation' | 'enterVariationFromPly' | 'enterVariationFromLive' | 'startReplayVariation' | 'variationGo' | 'exitVariation' | 'variationTryMove'> {
  return {
    variation: null,

  // ── UI 状态 ──

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
  }
}
