/**
 * 变化推演 slice — 多分支树 + 引擎评分对比
 */
import type { AppState, StoreSet, StoreGet } from '../types'
import type { BoardState, Pos, Move, Turn, VariationState, BranchLine } from '../types'
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

const MAIN_ID = 'main'

/** 取当前显示的变化线（主变或某分支） */
function lineOf(v: VariationState): BranchLine | null {
  if (v.currentId === null) return v.mainLine
  return v.branches.find(b => b.id === v.currentId) ?? v.mainLine
}

function lastMoveFromUci(uci: string, st: BoardState): Move {
  return {
    from: { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) },
    to: { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) },
    turn: st.turn === 'w' ? 'b' : 'w',
  }
}

function buildMainLine(game: Game, basePly: number): BranchLine {
  const baseFen = boardToFen(boardFromGame(game, basePly))
  const moves = game.plies.slice(basePly).map(p => p.move)
  const evals = game.plies.slice(basePly).map((_, i) => game.plies[basePly + i + 1]?.analysis?.score ?? null)
  return { id: MAIN_ID, parentId: null, divergePly: 0, moves, moveCns: pvToChinese(baseFen, moves), evals }
}

function playMoveFeedback(to: Pos, board: BoardState) {
  const settings = getSettings()
  const captured = board.board[to.col][to.row] !== '.'
  if (captured) playCaptureSound(settings.soundCapture)
  else playMoveSound(settings.soundMove)
}

export function createVariationSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'variation' | '_applyVariation' | 'enterVariationFromPly' | 'enterVariationFromLive' | 'startReplayVariation' | 'variationGo' | 'variationSelectBranch' | 'exitVariation' | 'variationTryMove'> {
  return {
    variation: null,

  // ── 内部：在起点局面上应用前 k 步 PV ──
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

  // ── 异步评测某分支最后一手（走棋方视角厘兵）──
    enterVariationFromPly: (plyIndex) => {
      const { game } = get()
      const ply = game.plies[plyIndex]
      const basePly = plyIndex
      const mainLine = buildMainLine(game, basePly)
      set({
        variation: { basePly, mainLine, branches: [], currentId: null, currentPly: 0 },
        board: boardFromGame(game, basePly),
        selected: null,
        legalTargets: [],
        lastMove: null,
      })
      const pv = ply?.analysis?.pv
      if (pv && pv.length) {
        const baseFen = boardToFen(boardFromGame(game, basePly))
        const branch: BranchLine = {
          id: generateId(), parentId: MAIN_ID, divergePly: 0,
          moves: pv.slice(0, 10), moveCns: pvToChinese(baseFen, pv.slice(0, 10)),
          evals: pv.slice(0, 10).map(() => null),
        }
        set({
          variation: {
            basePly, mainLine, branches: [branch], currentId: branch.id, currentPly: 0,
          },
        })
        requestBranchEval(set, get, branch.id)
      }
    },

    enterVariationFromLive: () => {
      const { analysis, currentPlyIndex, game } = get()
      if (!analysis || analysis.pv.length === 0) return
      const basePly = currentPlyIndex
      const mainLine = buildMainLine(game, basePly)
      const baseFen = boardToFen(boardFromGame(game, basePly))
      const branch: BranchLine = {
        id: generateId(), parentId: MAIN_ID, divergePly: 0,
        moves: analysis.pv.slice(0, 10), moveCns: pvToChinese(baseFen, analysis.pv.slice(0, 10)),
        evals: analysis.pv.slice(0, 10).map(() => null),
      }
      set({
        variation: {
          basePly, mainLine, branches: [branch], currentId: branch.id, currentPly: 0,
        },
        board: boardFromGame(game, basePly),
        selected: null,
        legalTargets: [],
        lastMove: null,
      })
      requestBranchEval(set, get, branch.id)
    },

  /** 复盘：从当前局面开始自由试走变化（多分支树） */
    startReplayVariation: () => {
      const { mode, currentPlyIndex, game } = get()
      if (mode !== 'replay') return
      const basePly = currentPlyIndex
      const mainLine = buildMainLine(game, basePly)
      set({
        variation: { basePly, mainLine, branches: [], currentId: null, currentPly: 0 },
        selected: null,
        legalTargets: [],
      })
    },

    variationGo: (k) => {
      const v = get().variation
      if (!v) return
      const line = lineOf(v)
      if (!line) return
      const index = Math.max(0, Math.min(k, line.moves.length))
      const st = get()._applyVariation(v.basePly, line.moves, index)
      const lastUci = index > 0 ? line.moves[index - 1] : null
      set({
        variation: { ...v, currentPly: index },
        board: st,
        lastMove: lastUci ? lastMoveFromUci(lastUci, st) : null,
      })
    },

    variationSelectBranch: (id) => {
      const v = get().variation
      if (!v) return
      const line = id === MAIN_ID ? v.mainLine : v.branches.find(b => b.id === id)
      if (!line) return
      const index = Math.min(v.currentPly, line.moves.length)
      const st = get()._applyVariation(v.basePly, line.moves, index)
      set({
        variation: { ...v, currentId: id === MAIN_ID ? null : id, currentPly: index },
        board: st,
        lastMove: index > 0 ? lastMoveFromUci(line.moves[index - 1], st) : null,
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

  /** 推演中在棋盘上落子：续走当前线或新建/复用分支（分支树语义） */
    variationTryMove: (from, to) => {
      const { board, variation, game } = get()
      if (!variation) return false

      const legalMoves = getLegalMoves(board, from.col, from.row)
      const uci = `${String.fromCharCode(97 + from.col)}${from.row}${String.fromCharCode(97 + to.col)}${to.row}`
      if (!legalMoves.some(m => m.col === to.col && m.row === to.row)) {
        set({ selected: null, legalTargets: [] })
        return false
      }

      const cur = lineOf(variation)
      const baseFen = boardToFen(boardFromGame(game, variation.basePly))

      // 沿当前线续走（点选主变/分支的下一手）
      if (cur && variation.currentPly < cur.moves.length && cur.moves[variation.currentPly] === uci) {
        const index = variation.currentPly + 1
        const st = get()._applyVariation(variation.basePly, cur.moves, index)
        set({
          variation: { ...variation, currentPly: index },
          board: st,
          lastMove: lastMoveFromUci(uci, st),
          selected: null,
          legalTargets: [],
        })
        playMoveFeedback(to, board)
        return true
      }

      // 分歧：以当前线为父，截断后续并写入新分支
      const parentMoves = cur ? cur.moves : []
      const parentEvals = cur ? cur.evals : []
      const newMoves = [...parentMoves.slice(0, variation.currentPly), uci]
      const newEvals = [...parentEvals.slice(0, variation.currentPly), null]
      const branch: BranchLine = {
        id: generateId(),
        parentId: variation.currentId ?? MAIN_ID,
        divergePly: variation.currentPly,
        moves: newMoves,
        moveCns: pvToChinese(baseFen, newMoves),
        evals: newEvals,
      }
      const index = variation.currentPly + 1
      const st = get()._applyVariation(variation.basePly, newMoves, index)
      set({
        variation: {
          ...variation,
          branches: [...variation.branches, branch],
          currentId: branch.id,
          currentPly: index,
        },
        board: st,
        lastMove: lastMoveFromUci(uci, st),
        selected: null,
        legalTargets: [],
      })
      playMoveFeedback(to, board)
      requestBranchEval(set, get, branch.id)
      return true
    },
  }
}

/** 评测某分支最后一手（走棋方视角厘兵），结果写回 evals 末尾 */
function requestBranchEval(
  set: StoreSet,
  get: StoreGet,
  branchId: string,
): void {
  const { engine, isThinking } = get() as { engine: PikafishEngine | null; isThinking: boolean }
  if (!engine || !engine.isReady) return

  void (async () => {
    const v0 = get().variation
    if (!v0) return
    const branch0 = v0.branches.find(b => b.id === branchId)
    if (!branch0) return
    const lastIdx = branch0.moves.length - 1
    if (lastIdx < 0) return

    const ve = get().variation
    if (!ve) return
    set({ variation: { ...ve, evaluating: true } })
    const fen = boardToFen(get()._applyVariation(v0.basePly, branch0.moves, lastIdx + 1))
    await acquireEngineSlot(() => get().isThinking)
    let ev: number | null = null
    try {
      const r = await engineEvalOnce(engine, fen, JUDGE_MIN_DEPTH)
      ev = r ? r.score : null
    } catch {
      ev = null
    }
    releaseEngineSlot()

    const v = get().variation
    if (!v) return
    const branch = v.branches.find(b => b.id === branchId)
    if (!branch) return
    const evals = branch.evals.slice()
    evals[lastIdx] = ev
    set({
      variation: {
        ...v,
        evaluating: false,
        branches: v.branches.map(b => (b.id === branchId ? { ...b, evals } : b)),
      },
    })
  })()
}
