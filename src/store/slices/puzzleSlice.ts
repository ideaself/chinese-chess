/**
 * 错误重走/残局训练 slice
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
import type { PuzzleItem } from '../../game/puzzles'
import { recordPuzzleCorrect, recordPuzzleWrong } from '../../game/puzzles'



export function createPuzzleSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'puzzlePlyIndex' | 'puzzleAttempts' | 'puzzleResult' | 'puzzleRevealed' | 'puzzleSource' | 'startPuzzle' | 'startLibraryPuzzle' | 'exitPuzzle' | 'puzzleTryMove' | 'revealPuzzleAnswer' | 'startPuzzleFromGame' | 'startEndgameTraining' | 'replayQuizMistake'> {
  return {
    puzzlePlyIndex: null,

    puzzleAttempts: 0,

    puzzleResult: 'waiting',

    puzzleRevealed: false,

    puzzleSource: null,

  // ── 变化推演 ──

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

    /** 精选题库: 构造单步棋谱复用重走判定（杀局/失误题/残局题） */

    startLibraryPuzzle: (p: PuzzleItem) => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)

    const turn = p.fen.split(' ')[1] === 'b' ? 'b' : 'w'
    const game = createEmptyGame()
    game.startFen = p.fen
    game.header.Event = p.event || p.type
    game.header.Red = p.red
    game.header.Black = p.black
    game.header.Result = p.result
    const bestMoveCn = p.best_move.length >= 4 ? chineseFromFen(p.fen, p.best_move) : undefined
    game.plies = [{
      plyIndex: 1,
      turn,
      move: p.move_uci,
      moveCn: p.move_uci.length >= 4 ? chineseFromFen(p.fen, p.move_uci) : '',
      fenBefore: p.fen,
      fenAfter: p.fen,
      inCheck: false,
      isCapture: false,
      analysis: {
        score: p.score_before ?? 0,
        depth: 12,
        bestMove: p.best_move,
        bestMoveCn,
        pv: [p.best_move],
        moveLoss: Math.max(0, p.score_drop ?? 0),
        classification: 'blunder',
        analyzedAt: Date.now(),
      },
    }]

    set({
      mode: 'puzzle',
      modeBeforeSetup: 'replay',
      timerInterval: null,
      game,
      board: boardFromFen(p.fen),
      puzzlePlyIndex: 0,
      puzzleAttempts: 0,
      puzzleResult: 'waiting',
      puzzleRevealed: false,
      puzzleSource: {
        type: p.type,
        title: p.event || '',
        red: p.red,
        black: p.black,
        mover: turn,
        drop: p.score_drop ?? 0,
      },
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
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
      puzzleSource: null,
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
      recordPuzzleCorrect()
    } else {
      set({ puzzleResult: 'wrong', puzzleAttempts: puzzleAttempts + 1 })
      recordPuzzleWrong()
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
      // 移动端多层导航：从错题本进入时切换到对战页
      mobilePage: 'play' as const,
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
      sideControl: { w: side === 'w' ? 'human' : 'ai', b: side === 'b' ? 'human' : 'ai' },
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
      analysis: null,
      redTime: 0,
      blackTime: 0,
      puzzlePlyIndex: null,
      // 移动端多层导航：残局训练切换到对战页
      mobilePage: 'play' as const,
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


  /** 重演拆解错题：退出拆解，从提问局面执原行棋方 vs 引擎 */

    replayQuizMistake: (m) => {
    set({ masterQuiz: null })
    get().startEndgameTraining(m.fen, '错题重演', m.turn)
  },

  /** 在 base 局面上应用前 k 步 PV */
  }
}
