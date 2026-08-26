/**
 * 引擎/AI 走棋/AI 分析 slice
 */
import type { AppState, StoreSet, StoreGet } from '../types'
import type { BoardState, Move, Pos, Turn, GameMode, Difficulty } from '../types'
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
import type { EngineInfo } from '../../engine/pikafish'

/**
 * 拟人降强：弱级以一定概率不走最优着法，而从 topN 候选里按权重（名次递减）挑一手。
 * 失误多为“次优”而非送子，模拟官方 Skill Level 的弱棋手观感。
 */
function pickSkillMove(cands: EngineInfo[], difficulty: Difficulty): string | null {
  const cfg = DIFFICULTY_SKILL[difficulty]
  if (!cands.length) return null
  if (cfg.p <= 0) return cands[0].move
  if (Math.random() > cfg.p) return cands[0].move
  const k = Math.min(cfg.topN, cands.length)
  const weights: number[] = []
  let w = 1
  for (let i = 0; i < k; i++) { weights.push(w); w *= 0.6 }
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * sum
  for (let i = 0; i < k; i++) {
    r -= weights[i]
    if (r <= 0) return cands[i].move
  }
  return cands[0].move
}
import { DIFFICULTY_DEPTH, DIFFICULTY_LABELS, DIFFICULTY_SKILL, DIFFICULTY_MOVE_TIME, QUICK_EVAL_MOVE_TIME } from '../constants'
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


/** 整盘分析取消标记 */
let analysisCancelFlag = false

/** 等待后台任务（快评等）释放引擎，超时返回 false */
async function waitForEngineIdle(get: StoreGet, maxMs = 10000): Promise<boolean> {
  for (let waited = 0; waited < maxMs; waited += 250) {
    if (!get().engineOccupied) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return !get().engineOccupied
}


export function createEngineSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'engine' | 'engineReady' | 'isThinking' | 'engineOccupied' | 'engineDepth' | 'analysis' | 'hintInfo' | 'analysisProgress' | 'evalBar' | 'setDifficulty' | 'init' | 'aiMove' | 'aiHint' | 'quickEval' | 'analyzePosition' | 'analyzeCurrentGame' | 'cancelAnalysis'> {
  return {
    engine: null,

    engineReady: false,

    isThinking: false,

    engineOccupied: false,

    engineDepth: 10,

    analysis: null,

    hintInfo: null,

    analysisProgress: null,

    evalBar: null,

  // ── 对局状态 ──

    setDifficulty: (d) => {
      set({ difficulty: d, engineDepth: DIFFICULTY_DEPTH[d] })
      const { engine } = get()
      if (engine && engine.isReady) {
        engine.setDepth(DIFFICULTY_DEPTH[d])
      }
    },

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

    aiMove: async () => {
    const { game, engine, engineDepth, difficulty, mode } = get()
    if (!engine || !engine.isReady || get().isThinking) return
    if (mode !== 'play') return
    // 引擎被后台任务占用时等待其结束，而非静默放弃（否则该回合无人重试，AI 停走）
    if (!(await waitForEngineIdle(get))) return

    const currentBoard = boardFromGame(game, game.plies.length)
    if (get().sideControl[currentBoard.turn] !== 'ai') return

    set({ isThinking: true })

    try {
      const engineFen = game.startFen
      const moveList = game.plies.map(p => p.move)
      // 对局改用时间预算驱动，避免长时间搜索卡死 UI（尤其高级别单线程 WASM）
      const moveTime = DIFFICULTY_MOVE_TIME[difficulty]

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
        const skill = DIFFICULTY_SKILL[difficulty]
        if (skill.p > 0) {
          // 拟人降强：弱级用 MultiPV 取前 topN 候选，按概率走次优着法（模拟 Skill Level）
          const cands = await engine.analyzeLines(engineFen, moveList, Math.min(engineDepth, 12), skill.topN, undefined, moveTime)
          bestUci = pickSkillMove(cands, difficulty)
        } else {
          bestUci = await engine.go(engineFen, moveList, engineDepth, moveTime)
        }
      }

      if (bestUci && bestUci !== '(none)' && bestUci.length >= 4) {
        const from = { col: bestUci.charCodeAt(0) - 97, row: parseInt(bestUci[1]) }
        const to = { col: bestUci.charCodeAt(2) - 97, row: parseInt(bestUci[3]) }
        // 兜底校验：所走之子必须属于当前行棋方（防止并发串扰/异常时 AI 动对方子）
        const piece = currentBoard.board[from.col]?.[from.row]
        const isRedPiece = piece !== '.' && piece === piece.toUpperCase()
        const sideOk = currentBoard.turn === 'w' ? isRedPiece : piece !== '.' && !isRedPiece
        if (sideOk) {
          get().tryMove(from, to)
        } else {
          console.error('AI 收到非法着法（与行棋方不符），已丢弃:', bestUci)
        }
      }
    } catch (e) {
      console.error('AI 走棋失败:', e)
    } finally {
      set({ isThinking: false })
      // AI 走完轮到玩家时自动评估局面（供评估条显示）；演示模式（下一方仍为 AI）
      // 不触发 quickEval，避免与下一步 engine.go 在同一引擎上并发搜索而中断链。
      const st = get()
      if (st.mode === 'play' && st.sideControl[st.board.turn] === 'human' && getSettings().autoEval !== false) {
        setTimeout(() => get().quickEval(), 120)
      }
    }
  },

    aiHint: async () => {
    const { game, engine, engineDepth } = get()
    if (!engine || !engine.isReady || get().isThinking) return
    if (!(await waitForEngineIdle(get))) return

    const currentBoard = boardFromGame(game, game.plies.length)
    const fen = boardToFen(currentBoard)
    const moveList = game.plies.map(p => p.move)

    set({ isThinking: true })
    try {
      // 引擎可能在最佳着法后补发一条无 pv 的 info，故本地保留最长 pv 的结果
      const holder: { latest: EngineInfo | null } = { latest: null }
      await engine.analyze(game.startFen, moveList, Math.min(engineDepth, 14), (info) => {
        if (!holder.latest || info.pv.length >= (holder.latest.pv?.length ?? 0)) holder.latest = info
        set({
          analysis: {
            depth: info.depth,
            score: info.score,
            bestMove: info.move,
            pv: info.pv.length ? info.pv : (holder.latest?.pv ?? []),
            fen,
          },
        })
      }, QUICK_EVAL_MOVE_TIME * 2)
      const latest = holder.latest
      if (latest && latest.move.length >= 4) {
        const lineUci = latest.pv.slice(0, 3) // pv[0] 即最佳着法，其后为对手应法与我方续着
        const line = lineUci.length > 1 ? pvToChinese(fen, lineUci) : [chineseFromFen(fen, latest.move)]
        set({
          hintInfo: {
            moveCn: chineseFromFen(fen, latest.move),
            score: latest.score,
            line: line.slice(0, 3),
            movesUci: lineUci,
          },
        })
      }
    } catch (e) {
      console.error('AI 提示失败:', e)
    } finally {
      set({ isThinking: false })
    }
  },

    quickEval: async () => {
    const s = get()
    if (!s.engine?.isReady || s.isThinking || s.engineOccupied) return
    if (s.mode !== 'play' || s.openingTraining || s.game.result !== '*') return
    const board = boardFromGame(s.game, s.game.plies.length)

    const fen = boardToFen(board)
    // 快评同样占用引擎：必须登记占用，否则 AI 回合的调度会在快评未结束时
    // 并发下发 go，旧搜索的 bestmove 会被误当成 AI 着法（曾致 AI 走对方子）。
    // 不复用 isThinking：那会禁用悔棋等用户操作。
    set({ engineOccupied: true })
    try {
      // 顶部评分条深度跟随 AI 难度（难度即引擎搜索深度），封顶 16 以免移动端卡顿；
      // 另加时间上限，保证尽快归还引擎
      await s.engine.analyze(s.game.startFen, s.game.plies.map(p => p.move), Math.min(s.engineDepth, 16), (info) => {
        set({
          analysis: {
            depth: info.depth,
            score: info.score,
            bestMove: info.move,
            pv: info.pv,
            fen,
          },
          evalBar: { score: info.score, fen, depth: info.depth, nodes: info.nodes, nps: info.nps },
        })
      }, QUICK_EVAL_MOVE_TIME)
    } catch {} finally {
      set({ engineOccupied: false })
    }
  },

    analyzePosition: async () => {
    const { game, engine, currentPlyIndex } = get()
    if (!engine || !engine.isReady) return

    const currentBoard = boardFromGame(game, currentPlyIndex)
    const fen = boardToFen(currentBoard)

    set({ isThinking: true })
    try {
      // 单局面分析用设置的分析深度（比整盘更深，只搜一个局面）
      await engine.analyze(game.startFen, game.plies.slice(0, currentPlyIndex).map(p => p.move), getSettings().analysisDepth + 4, (info) => {
        set({
          analysis: {
            depth: info.depth,
            score: info.score,
            bestMove: info.move,
            pv: info.pv,
            fen,
          },
          evalBar: { score: info.score, fen, depth: info.depth, nodes: info.nodes, nps: info.nps },
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

        await engine.analyze(game.startFen, moveList, depth, (info) => {
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
  }
}
