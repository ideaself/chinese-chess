/**
 * 摆棋模式 slice
 */
import type { AppState, StoreSet, StoreGet } from '../types'
import type { GameMode } from '../types'
import { boardFromFen, boardToFen, createEmptyBoard, START_FEN } from '../../game/board'
import { boardFromGame, parseMoveFromUci } from '../helpers'



export function createSetupSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'modeBeforeSetup' | 'setupTool' | 'setupTurn' | 'setupCandidates' | 'setupError' | 'enterSetup' | 'exitSetup' | 'setupClick' | 'setSetupTool' | 'setSetupTurn' | 'clearSetupBoard' | 'resetSetupBoard' | 'analyzeSetupPosition'> {
  return {
    modeBeforeSetup: 'play',

    setupTool: { kind: 'erase' },

    setupTurn: 'w',

    setupCandidates: null,

    setupError: '',

  // ── 开局训练 ──

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


  /** 从第 plyIndex 步（0-based）的失误局面开始重新挑战 */
  }
}
