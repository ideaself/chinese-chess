/**
 * 名局拆解训练 slice
 */
import type { AppState, StoreSet, StoreGet } from '../types'
import type { Pos } from '../types'
import type { Game } from '../../game/model'
import { boardFromFen } from '../../game/board'
import { getAllLegalMoves, chineseFromFen } from '../../game/rules'
import {
  getQuizStats, saveQuizStats, addQuizMistake, removeQuizMistake,
  getMasterAnalysis, putMasterAnalysis, MASTER_ANALYSIS_FMT,
} from '../../game/storage'
import type { MasterAnalysisRecord } from '../../game/storage'
import {
  pickBestKeyPly, engineEvalOnce, JUDGE_MIN_DEPTH, applyCachedAnalysis,
  acquireEngineSlot, releaseEngineSlot,
} from '../../game/masterPreanalysis'
import { getCachedLibrary, recordToGame } from '../../game/masterLibrary'
import { BOARD_HOME } from '../constants'


// ── 模块级状态与函数 ──
/** 名局拆解：为 ply 生成"猜着法"选项（1 正确 + 3 干扰项） */
function buildQuizOptions(game: Game, ply: number): { options: string[]; correct: string } {
  const fen = ply === 0 ? game.startFen : game.plies[ply - 1].fenAfter
  const state = boardFromFen(fen)
  const uciOf = (m: { from: Pos; to: Pos }) =>
    `${String.fromCharCode(97 + m.from.col)}${m.from.row}${String.fromCharCode(97 + m.to.col)}${m.to.row}`
  const correct = game.plies[ply].move
  const pool = getAllLegalMoves(state).map(uciOf).filter(u => u !== correct)
  // 洗牌取 3 个干扰项
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const options = [correct, ...pool.slice(0, 3)]
  // 选项顺序打乱
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return { options, correct }
}

/**
 * 当前拆解对局的预分析缓存（IDB 异步加载）。
 * 用于挑选"大师与引擎分歧最大"的关键手；id 校验防止换局后串用。
 */
let quizAnalysisRec: { id: string; rec: MasterAnalysisRecord | null } = { id: '', rec: null }
let quizOrigin: { activeTab: AppState['activeTab']; mobilePage: AppState['mobilePage']; sheetTab: string | null } | null = null

function quizCachedAnalysis(gameId: string): MasterAnalysisRecord | null {
  return quizAnalysisRec.id === gameId ? quizAnalysisRec.rec : null
}

function makeMasterQuizQuestion(
  game: Game,
  ply: number,
  prev?: { asked: number; right: number; streak: number; bestStreak: number; keyOnly: boolean },
): NonNullable<AppState['masterQuiz']> {
  const { options, correct } = buildQuizOptions(game, ply)
  // 战绩累计持久化：进行中从上一题续接，新会话从存档续接
  const saved = getQuizStats()
  return {
    ply,
    total: game.plies.length,
    options,
    correct,
    status: 'asking',
    asked: prev ? prev.asked : saved.asked,
    right: prev ? prev.right : saved.right,
    streak: prev?.streak ?? 0,
    bestStreak: Math.max(prev?.bestStreak ?? 0, saved.bestStreak),
    keyOnly: prev?.keyOnly ?? true,
  }
}

/**
 * 引擎判定拆解答案：玩家着法与大师不同但引擎同样推荐 → 改判正确（殊途同归）。
 * 优先查预分析缓存（即时且深度更高）；无缓存回退实时 depth 10，
 * 并把结果写透缓存供下次复用。仅在问题未变化时生效。
 */
export async function judgeQuizAlternative(get: StoreGet, set: StoreSet, uci: string): Promise<void> {
  const s = get()
  const quiz = s.masterQuiz
  if (!quiz) return
  const game = s.game

  // ── 快速路径：预分析缓存命中 → 即时判定，不再占用引擎 ──
  const rec = await getMasterAnalysis(game.id)
  const ev = rec && rec.fmt === MASTER_ANALYSIS_FMT ? rec.evals[quiz.ply] : undefined
  if (ev && ev.depth >= JUDGE_MIN_DEPTH) {
    if (ev.bestMove === uci) await applyQuizAiAgree(get, set, quiz)
    return
  }

  // ── 回退：实时引擎判定（原有路径）──
  if (!s.engine || !s.engineReady || s.isThinking) return
  set({ masterQuiz: { ...quiz, checking: true } })
  try {
    const fen = quiz.ply === 0 ? game.startFen : game.plies[quiz.ply].fenBefore
    // 引擎槽：与预热/批量预分析互斥（对战/整盘分析走 isThinking 已被其内部等待）
    await acquireEngineSlot(() => get().isThinking)
    let evLive = null
    try {
      evLive = await engineEvalOnce(s.engine, fen, 10)
    } finally {
      releaseEngineSlot()
    }
    if (evLive && evLive.bestMove === uci) {
      await applyQuizAiAgree(get, set, quiz)
      // 写透缓存：下次同局面即时判定（仅大师局）
      if (game.id.startsWith('dpxq_')) {
        void putMasterAnalysis({
          gameId: game.id,
          fmt: MASTER_ANALYSIS_FMT,
          depth: evLive.depth,
          createdAt: Date.now(),
          evals: { ...rec?.evals, [quiz.ply]: evLive },
        })
      }
    }
  } catch { /* 引擎不可用时静默跳过 */ } finally {
    const q = get().masterQuiz
    if (q?.checking) set({ masterQuiz: { ...q, checking: false } })
  }
}

/** 追认玩家答案为正确（殊途同归）：战绩回滚 + 移除错题；问题已切走则忽略 */
async function applyQuizAiAgree(get: StoreGet, set: StoreSet, snapshot: NonNullable<AppState['masterQuiz']>): Promise<void> {
  const q = get().masterQuiz
  // 问题已切走则不追认
  if (!q || q.ply !== snapshot.ply || q.status !== 'wrong' || q.answered !== snapshot.answered) return
  set({
    masterQuiz: {
      ...q,
      status: 'correct',
      aiAgree: true,
      right: q.right + 1,
      streak: q.streak + 1,
      bestStreak: Math.max(q.bestStreak, q.streak + 1),
    },
  })
  saveQuizStats({ asked: q.asked, right: q.right + 1, bestStreak: Math.max(q.bestStreak, q.streak + 1) })
  const game = get().game
  const fen = snapshot.ply === 0 ? game.startFen : game.plies[snapshot.ply].fenBefore
  removeQuizMistake(fen, snapshot.correct)
}

/**
 * 大师局预分析缓存物化：把缓存评估写到当前对局的 ply.analysis 上，
 * 点亮 KeyMoments / 评估曲线 / 失误标记（仅复盘查看用，不改动浏览位置）。
 */
export async function enrichMasterGame(get: StoreGet, set: StoreSet, gameId: string): Promise<void> {
  try {
    const rec = await getMasterAnalysis(gameId)
    if (!rec) return
    const s = get()
    if (s.game.id !== gameId) return
    const plies = applyCachedAnalysis(s.game.plies, rec)
    if (plies !== s.game.plies) {
      set({ game: { ...get().game, plies } })
    }
  } catch { /* 缓存不可用时静默跳过 */ }
}

export function createMasterQuizSlice(set: StoreSet, get: StoreGet): Pick<AppState,
    'masterQuiz' | 'startMasterQuiz' | 'answerMasterQuiz' | 'nextQuizPly' | 'exitMasterQuiz' | 'toggleQuizKeyMode'> {
  return {
    masterQuiz: null,

  // ── 引擎 ──

    startMasterQuiz: async (gameId) => {
    const games = getCachedLibrary()
    if (!games || games.length === 0) {
      get().showToast('大师库尚未加载，请先打开「大师库」页签')
      return
    }
    const current = get().game
    const selected = gameId && current.id === gameId && current.plies.length >= 40 ? current : null
    const pool = games.filter(g => g.mv.length / 4 >= 40)
    if (pool.length === 0) {
      get().showToast('⚠ 棋谱库为空')
      return
    }
    quizOrigin = {
      activeTab: get().activeTab,
      mobilePage: get().mobilePage,
      sheetTab: get().sheetTab,
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = pool[Math.floor(Math.random() * pool.length)]
      const game = selected ?? recordToGame(rec)
      if (!game || game.plies.length < 40) continue
      get().loadGameObject(game)
      // 拆解模式需要棋盘 → 切到对战页（loadGameObject 在棋谱页不会自动切）
      set({ activeTab: 'play', mobilePage: 'play' as const, sheetTab: BOARD_HOME })
      // 预取该局预分析缓存，关键手优先问"大师与引擎分歧最大"处
      quizAnalysisRec = { id: game.id, rec: await getMasterAnalysis(game.id) }
      // 关键手模式从第一个高价值关键点开始；全程模式从第 0 手开始
      const startPly = pickBestKeyPly(game, 0, quizAnalysisRec.rec)
      const quizPly = startPly >= 0 ? startPly : 0
      get().goToPly(quizPly)
      set({ masterQuiz: makeMasterQuizQuestion(game, quizPly) })
      return
    }
    get().showToast('⚠ 未能生成拆解对局，请重试')
  },

    answerMasterQuiz: (uci) => {
    const quiz = get().masterQuiz
    if (!quiz || quiz.status !== 'asking') return
    const correct = uci === quiz.correct
    set({
      masterQuiz: {
        ...quiz,
        status: correct ? 'correct' : 'wrong',
        answered: uci,
        aiAgree: undefined,
        asked: quiz.asked + 1,
        right: quiz.right + (correct ? 1 : 0),
        streak: correct ? quiz.streak + 1 : 0,
        bestStreak: Math.max(quiz.bestStreak, correct ? quiz.streak + 1 : 0),
      },
    })
    // 持久化累计战绩
    const q = get().masterQuiz!
    saveQuizStats({ asked: q.asked, right: q.right, bestStreak: q.bestStreak })
    // 答错记入拆解错题本
    if (!correct) {
      const game = get().game
      const fen = quiz.ply === 0 ? game.startFen : game.plies[quiz.ply].fenBefore
      addQuizMistake({
        fen,
        turn: boardFromFen(fen).turn,
        playerUci: uci,
        masterUci: quiz.correct,
        masterMoveCn: chineseFromFen(fen, quiz.correct),
        date: Date.now(),
      })
      void judgeQuizAlternative(get, set, uci)
    }
    // 展示大师的实际着法
    get().goToPly(quiz.ply + 1)
  },

    nextQuizPly: () => {
    const { masterQuiz, game } = get()
    if (!masterQuiz) return
    let nextPly = masterQuiz.ply + 1
    // 关键手模式跳到下一个吃子/将军点（有缓存时优先分歧最大处）
    if (masterQuiz.keyOnly && nextPly < game.plies.length) {
      const keyPly = pickBestKeyPly(game, nextPly, quizCachedAnalysis(game.id))
      if (keyPly >= 0) nextPly = keyPly
    }
    if (nextPly >= game.plies.length) {
      set({ masterQuiz: { ...masterQuiz, ply: nextPly, options: [], correct: '' } })
      return
    }
    set({
      masterQuiz: makeMasterQuizQuestion(game, nextPly, {
        asked: masterQuiz.asked,
        right: masterQuiz.right,
        streak: masterQuiz.streak,
        bestStreak: masterQuiz.bestStreak,
        keyOnly: masterQuiz.keyOnly,
      }),
    })
    get().goToPly(nextPly)
  },

    exitMasterQuiz: () => {
    const origin = quizOrigin
    quizOrigin = null
    set({
      masterQuiz: null,
      ...(origin ? {
        activeTab: origin.activeTab,
        mobilePage: origin.mobilePage,
        sheetTab: origin.sheetTab ?? BOARD_HOME,
      } : {}),
    })
  },

    toggleQuizKeyMode: () => {
    const { masterQuiz } = get()
    if (!masterQuiz) return
    set({ masterQuiz: { ...masterQuiz, keyOnly: !masterQuiz.keyOnly } })
  },
  }
}
