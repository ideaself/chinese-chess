/**
 * 对局状态与控制/棋谱操作/重放控制 slice
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
import { getBookMove, loadOpeningBook } from '../../game/book'
import { OPENING_LINES } from '../../game/openings'
import { getCachedLibrary, recordToGame } from '../../game/masterLibrary'
import { enrichMasterGame } from './masterQuizSlice'
import type { SideControl } from '../types'
import { playMoveSound, playCaptureSound, playCaptureVoice, playCheckSound, playCheckVoice, playCheckHaptic, playMoveHaptic, playGameOverHaptic, resumeAudio } from '../../game/sound'

/** 复盘/棋谱走子音效：前进时按吃子判定，后退时轻响 */
function playReplayStep(game: Game, plyIndex: number, forward: boolean) {
  const settings = getSettings()
  if (!settings.soundReplay) return
  const ply = game.plies[plyIndex]
  if (!ply) {
    if (!forward) playMoveSound(settings.soundMove)
    return
  }
  if (forward) {
    const before = boardFromGame(game, plyIndex)
    const toCol = ply.move.charCodeAt(2) - 97
    const toRow = Number(ply.move[3])
    const captured = before.board[toCol][toRow] !== '.'
    if (captured) {
      playCaptureSound(settings.soundCapture)
      playCaptureVoice(settings.soundCaptureVoice)
    } else {
      playMoveSound(settings.soundMove)
    }
  } else {
    playMoveSound(settings.soundMove)
  }
}



export function createGameSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'mode' | 'game' | 'board' | 'difficulty' | 'playerSide' | 'sideControl' | 'boardFlipped' | 'lastRatingChange' | 'autoPlaying' | 'setAutoPlaying' | 'currentPlyIndex' | 'selected' | 'legalTargets' | 'lastMove' | 'redTime' | 'blackTime' | 'timerInterval' | 'savedGames' | 'startNewGame' | 'selectPiece' | 'tryMove' | 'undo' | 'restart' | 'flipBoard' | 'resign' | 'offerDraw' | 'saveCurrentGame' | 'loadGame' | 'loadGameObject' | 'loadFromPGN' | 'exportCurrentPGN' | 'deleteGameById' | 'goToStart' | 'goToEnd' | 'goBack' | 'goForward' | 'goToPly' | 'refreshSavedGames'> {
  // AI（含 AI 演示）自动走棋调度：演示模式间隔 1 秒，并在引擎空闲后再落子，
  // 避免与 quickEval 并发搜索导致链断。
  const scheduleAiMove = (base: number) => {
    const st = get()
    if (st.mode !== 'play') return
    if (st.sideControl[st.board.turn] !== 'ai') return
    const demo = st.sideControl.w === 'ai' && st.sideControl.b === 'ai'
    const delay = demo ? 1000 : base
    setTimeout(() => {
      const step = () => {
        const s = get()
        if (s.mode !== 'play') return
        if (s.sideControl[s.board.turn] !== 'ai') return
        if (s.isThinking || s.engineOccupied || !s.engineReady || !s.engine) { setTimeout(step, 250); return }
        get().aiMove()
      }
      step()
    }, delay)
  }

  return {
    mode: 'play',

    game: createEmptyGame(),

    board: boardFromFen(START_FEN),

    difficulty: 'medium',

    playerSide: 'w',

    sideControl: { w: 'human', b: 'ai' },

    boardFlipped: false,

    lastRatingChange: null,

  // ── 摆棋模式 ──

    autoPlaying: false,

    setAutoPlaying: (v) => set({ autoPlaying: v }),

  // ── 设置 ──

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

    startNewGame: (difficulty, playerSide, control) => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)

    // 对局角色：未指定时按 playerSide 推导（单人机）
    const sideControl: SideControl = control ?? {
      w: playerSide === 'w' ? 'human' : 'ai',
      b: playerSide === 'b' ? 'human' : 'ai',
    }
    const hotseat = sideControl.w === 'human' && sideControl.b === 'human'
    const demo = sideControl.w === 'ai' && sideControl.b === 'ai'

    const game = createEmptyGame()
    if (hotseat) {
      game.header.Event = '双人对战'
      game.header.Red = '玩家一'
      game.header.Black = '玩家二'
    } else {
      game.header.Red = sideControl.w === 'human' ? '玩家' : DIFFICULTY_LABELS[difficulty]
      game.header.Black = sideControl.b === 'human' ? '玩家' : DIFFICULTY_LABELS[difficulty]
      if (demo) game.header.Event = 'AI 对弈演示'
    }
    game.header.Difficulty = difficulty

    set({
      mode: 'play',
      game,
      board: boardFromFen(game.startFen),
      difficulty,
      playerSide,
      sideControl,
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

    // AI 先手时自动走棋（红方先手）
    if (sideControl.w === 'ai') {
      scheduleAiMove(500)
    }
  },

    selectPiece: (pos) => {
    const state = get()
    const { board, selected, mode } = state
    // 推演模式下允许在棋盘上试走变化
    if (mode !== 'play' && mode !== 'puzzle' && !(mode === 'replay' && state.variation)) return

    // AI 回合禁止操作（防误替 AI 走棋）；开局训练不受限
    if (mode === 'play' && !state.openingTraining && get().sideControl[board.turn] === 'ai') {
      set({ selected: null, legalTargets: [] })
      return
    }

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
    const { board, mode, game, engine, engineReady } = get()

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
      playCaptureVoice(settings.soundCaptureVoice)
    } else {
      playMoveSound(settings.soundMove)
    }
    if (status.inCheck) {
      playCheckSound(settings.soundCheck)
      playCheckVoice(settings.soundCheckVoice)
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

    // 轮到 AI：自动走棋；轮到人类（含双人）：刷新评估条
    if (mode === 'play' && engineReady && engine && !get().openingTraining) {
      if (get().sideControl[newState.turn] === 'ai') {
        scheduleAiMove(200)
      } else {
        setTimeout(() => { if (get().settings.autoEval !== false) get().quickEval() }, 150)
      }
    }

    return true
  },

    undo: () => {
    const { game, mode, currentPlyIndex, sideControl, playerSide } = get()
    if (mode !== 'play' || get().isThinking) return
    if (get().openingTraining) return // 开局训练中不可悔棋
    if (game.result !== '*') return
    if (currentPlyIndex <= 0) return

    const hotseat = sideControl.w === 'human' && sideControl.b === 'human'

    /** 第 k 个局面轮到谁走 */
    const turnAt = (k: number): Turn => {
      if (k === 0) return boardFromFen(game.startFen).turn
      return game.plies[k - 1].turn === 'w' ? 'b' : 'w'
    }

    // 双人：回退一手；人机：撤回到最近的"轮到玩家行棋"的局面（严格早于当前）
    let target = currentPlyIndex - 1
    if (!hotseat) {
      while (target > 0 && turnAt(target) !== playerSide) target--
    }

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
    if (sideControl[turnAt(target)] === 'ai') {
      scheduleAiMove(300)
    } else {
      setTimeout(() => { if (get().settings.autoEval !== false) get().quickEval() }, 150)
    }
  },

    restart: () => {
    const { difficulty, playerSide, sideControl } = get()
    get().startNewGame(difficulty, playerSide, sideControl)
  },

    flipBoard: () => set(s => ({ boardFlipped: !s.boardFlipped })),

    resign: () => {
    const { game, sideControl, mode, timerInterval } = get()
    if (mode !== 'play' || game.result !== '*') return
    // 仅单人人机可认输；双人/AI 演示不支持
    const humanSide: Turn | null =
      sideControl.w === 'human' && sideControl.b === 'ai' ? 'w'
        : sideControl.b === 'human' && sideControl.w === 'ai' ? 'b' : null
    if (!humanSide) return
    if (timerInterval) clearInterval(timerInterval)
    const result = humanSide === 'w' ? '0-1' : '1-0'
    const updatedGame = { ...game, result, updatedAt: Date.now() }
    set({ game: updatedGame, timerInterval: null })
    get().saveCurrentGame()
  },

    offerDraw: () => {
    const { game, sideControl, mode, timerInterval } = get()
    if (mode !== 'play' || game.result !== '*') return
    // AI 演示不适用
    if (sideControl.w === 'ai' && sideControl.b === 'ai') return
    if (timerInterval) clearInterval(timerInterval)
    const updatedGame = { ...game, result: '1/2-1/2', updatedAt: Date.now() }
    set({ game: updatedGame, timerInterval: null })
    get().saveCurrentGame()
  },

    saveCurrentGame: () => {
    const { game, sideControl } = get()
    if (game.plies.length === 0) return
    // AI 对弈演示不入棋谱库
    if (sideControl.w === 'ai' && sideControl.b === 'ai') return

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
      // 移动端：从棋谱库点开对局回到纯棋盘主页（关闭覆盖层）
      sheetTab: null,
    })

    // 大师局：应用已缓存的预分析点亮复盘视图（整盘分析改为曲线区手动触发）
    if (game.id.startsWith('dpxq_')) {
      void enrichMasterGame(get, set, game.id)
    }
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
      if (idx > 0) playReplayStep(game, idx - 1, true)
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
      playReplayStep(game, currentPlyIndex - 1, false)
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
      playReplayStep(game, currentPlyIndex, true)
    },

    goToPly: (index) => {
      const { game, currentPlyIndex: prevIdx } = get()
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
      if (clamped > 0) playReplayStep(game, clamped - 1, clamped >= prevIdx)
    },


  /** 快速评估当前局面（对局中自动触发，供评估条显示） */

    refreshSavedGames: () => {
    set({ savedGames: getAllGames() })
  },


  /** 从当前局面进入摆棋 */
  }
}
