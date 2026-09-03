/**
 * 错误重走/残局训练 slice
 */
import type { AppState, StoreSet, StoreGet } from '../types'
import type { Turn } from '../types'
import { makeMove, boardFromFen } from '../../game/board'
import { chineseFromFen } from '../../game/rules'
import { createEmptyGame } from '../../game/model'
import { getAllGames } from '../../game/storage'
import { boardFromGame, parseMoveFromUci } from '../helpers'
import type { PuzzleItem } from '../../game/puzzles'
import { recordPuzzleCorrect, recordPuzzleWrong, difficultyFromDrop, getDailyPuzzle } from '../../game/puzzles'
import { recordPuzzleAnswer, recordMistakeRetry, isMistakeAutoMastered } from '../../game/progress'
import { toggleMastered } from '../../game/storage'

/** 正在重走的错题去重键（局面|着法），用于错题重练追踪；题库/每日题时为 null */
let activeMistakeKey: string | null = null



export function createPuzzleSlice(set: StoreSet, get: StoreGet): Pick<AppState,
  'puzzlePlyIndex' | 'puzzleAttempts' | 'puzzleResult' | 'puzzleRevealed' | 'puzzleSource' | 'endgameTraining' | 'startPuzzle' | 'startLibraryPuzzle' | 'exitPuzzle' | 'puzzleTryMove' | 'revealPuzzleAnswer' | 'startPuzzleFromGame' | 'startEndgameTraining' | 'replayQuizMistake'> {
  return {
  endgameTraining: false,

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
    activeMistakeKey = null

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
    activeMistakeKey = null
    const replayOrigin = get().mobilePage
    const replayOriginTab = get().activeTab
    // 是否当日挑战题（同题型且 game_id+ply 匹配，供完成标记）
    const daily = getDailyPuzzle(p.type)
    const isDaily = !!daily && daily.game_id === p.game_id && daily.ply === p.ply

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
      endgameTraining: false,
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
        isDaily,
      },
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
      activeTab: 'play',
      mobilePage: 'play' as const,
      replayOrigin,
      replayOriginTab,
    })
  },

    exitPuzzle: () => {
    const { game, currentPlyIndex, replayOrigin, replayOriginTab } = get()
    activeMistakeKey = null
    set({
      mode: 'replay',
      endgameTraining: false,
      board: boardFromGame(game, currentPlyIndex),
      puzzlePlyIndex: null,
      puzzleResult: 'waiting',
      puzzleRevealed: false,
      puzzleSource: null,
      selected: null,
      legalTargets: [],
      activeTab: replayOriginTab ?? 'play',
      mobilePage: replayOrigin ?? 'play',
      replayOrigin: null,
      replayOriginTab: null,
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
      const src = get().puzzleSource
      if (src) {
        // 题库题：完整统计（题型/难度/每日完成 + streak）
        recordPuzzleAnswer({
          type: src.type,
          difficulty: difficultyFromDrop(src.type, src.drop),
          correct: true,
          isDaily: src.isDaily,
        })
      } else {
        recordPuzzleCorrect()
      }
      if (activeMistakeKey) {
        recordMistakeRetry(activeMistakeKey, true)
        if (isMistakeAutoMastered(activeMistakeKey)) {
          toggleMastered(activeMistakeKey)
          get().showToast('连续答对 2 次，错题已自动标记掌握 ✓')
        }
      }
    } else {
      set({ puzzleResult: 'wrong', puzzleAttempts: puzzleAttempts + 1 })
      const src = get().puzzleSource
      if (src) {
        recordPuzzleAnswer({
          type: src.type,
          difficulty: difficultyFromDrop(src.type, src.drop),
          correct: false,
          isDaily: src.isDaily,
        })
      } else {
        recordPuzzleWrong()
      }
      if (activeMistakeKey) recordMistakeRetry(activeMistakeKey, false)
    }
    return true
  },

    revealPuzzleAnswer: () => set({ puzzleRevealed: true }),

  /** 错题本入口: 载入对应棋谱后进入重走模式 */

    startPuzzleFromGame: (gameId, plyIndex) => {
    const g = getAllGames().find(x => x.id === gameId)
    if (!g || !g.plies[plyIndex]?.analysis?.bestMove) return

    const replayOrigin = get().mobilePage
    const replayOriginTab = get().activeTab
    // 先以 replay 形式载入该棋谱（退出重走时回到它的复盘）
    set({
      game: g,
      mode: 'replay',
      endgameTraining: false,
      currentPlyIndex: plyIndex,
      // 移动端多层导航：从错题本进入时切换到对战页
      mobilePage: 'play' as const,
      activeTab: 'play',
      replayOrigin,
      replayOriginTab,
    })
    get().startPuzzle(plyIndex)
    // 错题重练追踪键（与 getMistakes 去重键一致：局面|着法）；
    // startPuzzle 内会先清空，这里在其后设置
    const ply = g.plies[plyIndex]
    activeMistakeKey = `${ply.fenBefore.split(' ').slice(0, 2).join(' ')}|${ply.move}`
  },

  /** 残局训练: 自定义起始局面，玩家执红先行 */

    startEndgameTraining: (fen, name, side = 'w') => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)
    const replayOrigin = get().mobilePage
    const replayOriginTab = get().activeTab

    const game = createEmptyGame()
    game.startFen = fen
    game.header.Event = side === 'w' ? '残局训练' : '残局训练（执黑）'
    game.header.Red = side === 'w' ? '玩家' : name
    game.header.Black = side === 'b' ? '玩家' : name

    set({
      mode: 'play',
      endgameTraining: true,
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
      activeTab: 'play',
      replayOrigin,
      replayOriginTab,
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
