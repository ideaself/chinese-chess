/**
 * 大师局批量预分析
 *
 * 用引擎预分析大师棋谱的关键局面（吃子/将军手及其后一手），
 * 结果按局缓存到 IndexedDB（storage.ts 的 master_analysis store）。
 * 拆解训练据此实现：
 *   - 殊途同归判定即时化、更深（不再现场跑 depth 10）
 *   - 关键手提问点更准（优先问大师与引擎分歧最大的地方）
 *
 * 本模块不直接依赖 store：引擎实例与"引擎忙"探测由调用方注入，
 * 执行器在每个局面开跑前等待引擎空闲（对战/复盘优先），可随时停止；
 * 每局分析完立即落库，中断不丢已完成部分。
 */

import type { Game, Ply, PlyAnalysis } from './model'
import type { PikafishEngine } from '../engine/pikafish'
import type { EngineInfo } from '../engine/pikafish'
import { chineseFromFen } from './rules'
import {
  getCachedLibrary, loadMoreGames, hasMoreGames,
  recordToGame, recordTitle,
} from './masterLibrary'
import {
  MASTER_ANALYSIS_FMT,
  getMasterAnalysis, putMasterAnalysis, getAllMasterAnalysisIds,
  type MasterPosEval, type MasterAnalysisRecord,
} from './storage'

/** 预分析深度：高于实时判定的 depth 10，成本可控 */
export const PREANALYSIS_DEPTH = 12

/** 缓存评估被采信的最低深度（低于此值回退实时判定） */
export const JUDGE_MIN_DEPTH = 10

/** 与整盘分析一致的损失截断（厘兵） */
const clampEval = (v: number) => Math.max(-1500, Math.min(1500, v))

/** 局面序号 i 的 FEN（i = 第 i 手之前的局面） */
export function fenAtPosition(game: Game, i: number): string {
  return i === 0 ? game.startFen : game.plies[i - 1].fenAfter
}

/** 由缓存的相邻两手评估计算大师着法损失（厘兵）；缺手或深度不足返回 null */
export function moveLossFromEvals(rec: MasterAnalysisRecord, plyIndex: number): number | null {
  const before = rec.evals[plyIndex]
  const after = rec.evals[plyIndex + 1]
  if (!before || !after || before.depth < JUDGE_MIN_DEPTH || after.depth < JUDGE_MIN_DEPTH) return null
  return Math.max(0, clampEval(before.score) + clampEval(after.score))
}

/** 根据走法损失（厘兵）分类走法质量（与整盘分析一致） */
export function classifyMove(moveLoss: number): PlyAnalysis['classification'] {
  if (moveLoss === 0) return 'best'
  if (moveLoss < 10) return 'excellent'  // < 0.1兵
  if (moveLoss < 30) return 'good'       // < 0.3兵
  if (moveLoss < 80) return 'inaccuracy' // < 0.8兵
  if (moveLoss < 150) return 'mistake'   // < 1.5兵
  if (moveLoss < 300) return 'blunder'   // < 3兵
  return 'blunder2'                       // >= 3兵
}

/**
 * 一局棋需要预分析的局面序号：
 * 每个关键手（吃子/将军）k 取 {k, k+1}，前者供判定最佳着，后者算损失。
 */
export function keyPositionIndices(game: Game): number[] {
  const idx = new Set<number>()
  for (let k = 0; k < game.plies.length; k++) {
    if (game.plies[k].isCapture || game.plies[k].inCheck) {
      idx.add(k)
      idx.add(k + 1)
    }
  }
  return [...idx].sort((a, b) => a - b)
}

/**
 * 从候选关键手中挑"最有教学价值"的一手：
 * 有缓存时选大师与引擎分歧最大（moveLoss 最高）处；无有效缓存退化为首个关键手。
 */
export function pickBestKeyPly(game: Game, fromPly: number, rec: MasterAnalysisRecord | null | undefined): number {
  const candidates: number[] = []
  for (let k = Math.max(fromPly, 0); k < game.plies.length; k++) {
    if (game.plies[k].isCapture || game.plies[k].inCheck) candidates.push(k)
  }
  if (candidates.length === 0) return -1
  if (!rec || rec.fmt !== MASTER_ANALYSIS_FMT) return candidates[0]
  let best = candidates[0]
  let bestLoss = -1
  for (const k of candidates) {
    const loss = moveLossFromEvals(rec, k)
    if (loss !== null && loss > bestLoss) { bestLoss = loss; best = k }
  }
  return best
}

/**
 * 引擎单局面评估：搜到指定深度后返回最终 info（走棋方视角）。
 * 共享调用方的单引擎实例，需自行保证引擎空闲。
 */
export function engineEvalOnce(
  engine: PikafishEngine,
  fen: string,
  depth: number,
): Promise<MasterPosEval | null> {
  let last: EngineInfo | null = null
  return engine.analyze(fen, [], depth, (info) => { last = info }).then(() =>
    last
      ? { score: last.score, depth: last.depth, bestMove: last.move, pv: last.pv.slice(0, 6) }
      : null,
  )
}

// ── 缓存物化（点亮大师局复盘分析） ────────────────────────────────

/**
 * 将预分析缓存物化为 Ply.analysis：
 * 有前后手完整缓存的着法获得 moveLoss/分类/最佳着，已有人工分析的 ply 保持不变。
 * 无可新增数据时返回原数组引用。
 */
export function applyCachedAnalysis(plies: Ply[], rec: MasterAnalysisRecord): Ply[] {
  if (rec.fmt !== MASTER_ANALYSIS_FMT) return plies
  let changed = false
  const out = plies.map((ply, i) => {
    if (ply.analysis) return ply
    const before = rec.evals[i]
    const after = rec.evals[i + 1]
    if (!before || !after || before.depth < JUDGE_MIN_DEPTH || after.depth < JUDGE_MIN_DEPTH) return ply
    const moveLoss = Math.max(0, clampEval(before.score) + clampEval(after.score))
    changed = true
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
        classification: classifyMove(moveLoss),
        analyzedAt: rec.createdAt || Date.now(),
      },
    }
  })
  return changed ? out : plies
}

/** 还缺哪些关键局面（未缓存或深度不足），预热器只补缺口 */
export function missingKeyPositions(game: Game, rec: MasterAnalysisRecord | null | undefined): number[] {
  return keyPositionIndices(game).filter(i => {
    const ev = rec?.evals[i]
    return !ev || ev.depth < PREANALYSIS_DEPTH
  })
}

// ── 引擎槽（批量/预热/实时判定 共用互斥） ──────────────────────────

let slotBusy = false

export function isEngineSlotBusy(): boolean {
  return slotBusy
}

/**
 * 获取引擎槽：与其它槽使用者互斥；externalBusy 为真时让路
 * （对局 AI 行棋/整盘分析等走 store.isThinking 的引擎任务）。
 */
export async function acquireEngineSlot(externalBusy?: () => boolean): Promise<void> {
  while (slotBusy || externalBusy?.()) {
    await sleep(120)
  }
  slotBusy = true
}

export function releaseEngineSlot(): void {
  slotBusy = false
}

// ── 批量执行器 ────────────────────────────────────────────────────

export interface PreanalysisProgress {
  /** 已处理（含跳过）的局数 */
  gamesDone: number
  gamesTotal: number
  positionsDone: number
  positionsTotal: number
  currentTitle: string
}

export interface PreanalysisSummary {
  analysed: number
  skipped: number
  failed: number
  cancelled: boolean
  message?: string
}

export interface PreanalysisHandle {
  cancel(): void
}

export interface PreanalysisDeps {
  /** app 单例引擎；未就绪时批处理立即结束 */
  getEngine: () => PikafishEngine | null
  /** 引擎正被对局/整盘分析占用时为 true，执行器让路等待 */
  isEngineBusy: () => boolean
}

let runningHandle: PreanalysisHandle | null = null

export function isPreanalysisRunning(): boolean {
  return runningHandle !== null
}

/** 停止正在进行的批量预分析（无任务时空操作） */
export function cancelPreanalysis(): void {
  runningHandle?.cancel()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 启动批量预分析：补拉剩余分片覆盖全库，
 * 跳过已缓存对局，逐局分析关键点并落库。重复调用返回 null。
 */
export function startPreanalysis(opts: {
  deps: PreanalysisDeps
  onProgress?: (p: PreanalysisProgress) => void
  onDone: (s: PreanalysisSummary) => void
}): PreanalysisHandle | null {
  if (runningHandle) return null

  let cancelled = false
  const handle: PreanalysisHandle = {
    cancel: () => { cancelled = true },
  }
  runningHandle = handle

  void (async () => {
    const s = opts.onProgress
    const summary: PreanalysisSummary = { analysed: 0, skipped: 0, failed: 0, cancelled: false }
    try {
      // 补拉剩余分片，让一次批处理覆盖全库
      while (hasMoreGames()) {
        await loadMoreGames()
        await sleep(50) // 让出主线程，避免连续 fetch 解析卡顿
      }
      const lib = getCachedLibrary()
      if (!lib || lib.length === 0) {
        opts.onDone({ ...summary, message: '大师库尚未加载' })
        return
      }

      const { getEngine, isEngineBusy } = opts.deps
      const engine = getEngine()
      if (!engine || !engine.isReady) {
        opts.onDone({ ...summary, message: '引擎未就绪' })
        return
      }

      const done = await getAllMasterAnalysisIds()
      // 与拆解选题一致：过短的对局没有训练价值
      const pool = lib.filter(g => g.mv.length / 4 >= 40 && !done.has(`dpxq_${g.id}`))

      let gamesDone = 0
      for (const rec of pool) {
        if (cancelled) break
        const game = recordToGame(rec)
        if (!game || game.plies.length < 40) { summary.skipped++; gamesDone++; continue }

        const positions = keyPositionIndices(game)
        const title = recordTitle(rec)
        const emit = (posDone: number) => s?.({
          gamesDone: gamesDone + 1,
          gamesTotal: pool.length,
          positionsDone: posDone,
          positionsTotal: positions.length,
          currentTitle: title,
        })

        const evals: Record<number, MasterPosEval> = {}
        for (let pi = 0; pi < positions.length; pi++) {
          if (cancelled) break
          // 引擎槽：与预热/实时判定互斥，对局占用时让路
          await acquireEngineSlot(isEngineBusy)
          if (cancelled) { releaseEngineSlot(); break }
          try {
            const ev = await engineEvalOnce(engine, fenAtPosition(game, positions[pi]), PREANALYSIS_DEPTH)
            if (ev) evals[positions[pi]] = ev
          } catch { /* 单局面失败不影响整局 */ }
          releaseEngineSlot()
          emit(pi + 1)
        }

        if (Object.keys(evals).length > 0) {
          // 合并旧记录（保留此前懒式写透的单点结果）
          const prev = await getMasterAnalysis(game.id)
          const merged: MasterAnalysisRecord = {
            gameId: game.id,
            fmt: MASTER_ANALYSIS_FMT,
            depth: PREANALYSIS_DEPTH,
            createdAt: Date.now(),
            evals: { ...prev?.evals, ...evals },
          }
          if (await putMasterAnalysis(merged)) summary.analysed++
          else summary.failed++
        } else {
          summary.failed++
        }
        gamesDone++
      }

      summary.cancelled = cancelled
    } catch (e) {
      summary.message = e instanceof Error ? e.message : String(e)
    } finally {
      runningHandle = null
      opts.onDone(summary)
    }
  })()

  return handle
}

// ── 单局预热（拆解/复盘打开大师局时后台补缺口） ────────────────────

let warmupCancelFlag = false
let warmupRunning = false
let warmupTargetId = ''

/** 当前是否有单局预热在跑 */
export function isWarmupActive(): boolean {
  return warmupRunning
}

/** 停止当前预热（换局时自动调用；无任务时空操作） */
export function cancelWarmup(): void {
  warmupCancelFlag = true
}

/**
 * 预热一局大师对局：只分析缺失/深度不足的关键点，
 * 引擎槽互斥（对战优先），每 4 个局面落库一次并回调 onUpdate
 * （供调用方刷新物化视图）。非大师局或批量运行中直接忽略。
 */
export function warmupGame(
  game: Game,
  deps: PreanalysisDeps,
  onUpdate?: () => void,
): void {
  if (!game.id.startsWith('dpxq_')) return
  if (isPreanalysisRunning()) return // 批量已覆盖全库
  if (warmupRunning && warmupTargetId === game.id) return

  cancelWarmup()
  warmupCancelFlag = false
  warmupRunning = true
  warmupTargetId = game.id

  void (async () => {
    try {
      let rec: MasterAnalysisRecord | null = null
      try { rec = await getMasterAnalysis(game.id) } catch { /* ignore */ }
      const positions = missingKeyPositions(game, rec)
      if (positions.length === 0) return

      const engine = deps.getEngine()
      if (!engine || !engine.isReady) return

      const pending: Record<number, MasterPosEval> = {}
      const flush = async () => {
        if (Object.keys(pending).length === 0) return
        let prev: MasterAnalysisRecord | null = null
        try { prev = await getMasterAnalysis(game.id) } catch { /* ignore */ }
        await putMasterAnalysis({
          gameId: game.id,
          fmt: MASTER_ANALYSIS_FMT,
          depth: PREANALYSIS_DEPTH,
          createdAt: Date.now(),
          evals: { ...prev?.evals, ...pending },
        })
        for (const k of Object.keys(pending)) delete pending[Number(k)]
        onUpdate?.()
      }

      for (const pos of positions) {
        if (warmupCancelFlag) break
        await acquireEngineSlot(deps.isEngineBusy)
        if (warmupCancelFlag) { releaseEngineSlot(); break }
        try {
          const ev = await engineEvalOnce(engine, fenAtPosition(game, pos), PREANALYSIS_DEPTH)
          if (ev) pending[pos] = ev
        } catch { /* 单局面失败不影响整体 */ }
        releaseEngineSlot()
        if (Object.keys(pending).length >= 4) await flush()
      }
      await flush()
    } finally {
      warmupRunning = false
      warmupTargetId = ''
    }
  })()
}
