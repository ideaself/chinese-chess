/**
 * 大师局静态关键点分析（public/master-analysis/ 分片）
 *
 * 141k 局棋谱的 Pikafish 分析离线导出：打开大师局时直接加载关键点
 * （失误/转折步的 before/after 评分 + 最佳着），无需引擎实时计算。
 *
 * 数据格式: { gameId: { ply: {s, a, b, d, m} } }
 *   s/a = 红方视角评分（厘兵），b = 最佳着，d = 掉分，m = 1失误/2严重
 * 转成 MasterAnalysisRecord 后复用 applyCachedAnalysis 物化。
 */

import type { MasterAnalysisRecord, MasterPosEval } from './storage'
import { MASTER_ANALYSIS_FMT } from './storage'

interface StaticPly {
  s: number
  a: number
  b: string
  d: number
  m: number
}

type StaticGame = Record<string, StaticPly>

const SHARD_SIZE = 20000
const shardCache = new Map<number, Record<string, StaticGame>>()

function shardFile(gameId: number): string {
  const lo = Math.floor((gameId - 1) / SHARD_SIZE) * SHARD_SIZE + 1
  const hi = lo + SHARD_SIZE - 1
  return `analysis_${String(lo).padStart(6, '0')}-${String(hi).padStart(6, '0')}.json`
}

async function loadShard(gameId: number): Promise<Record<string, StaticGame> | null> {
  const key = Math.floor((gameId - 1) / SHARD_SIZE)
  if (shardCache.has(key)) return shardCache.get(key) ?? null
  try {
    const res = await fetch(`master-analysis/${shardFile(gameId)}`)
    if (!res.ok) return null
    const data: { games: Record<string, StaticGame> } = await res.json()
    shardCache.set(key, data.games)
    return data.games
  } catch {
    return null
  }
}

/** 将红方视角评分转为走棋方视角（app 惯例） */
function toMover(plyIndex: number, redScore: number): number {
  return plyIndex % 2 === 0 ? redScore : -redScore
}

/**
 * 加载某局静态关键点并转为 MasterAnalysisRecord（未收录返回 null）。
 * 该记录可经 applyCachedAnalysis 物化为 Ply.analysis。
 */
export async function loadStaticAnalysis(gameId: number): Promise<MasterAnalysisRecord | null> {
  const shard = await loadShard(gameId)
  if (!shard) return null
  const key = String(gameId)
  const data = shard[key]
  if (!data || Object.keys(data).length === 0) return null

  const evals: Record<number, MasterPosEval> = {}
  for (const [plyStr, p] of Object.entries(data)) {
    const ply = parseInt(plyStr)          // DB ply, 1-based
    const beforeIdx = ply - 1             // app ply index
    evals[beforeIdx] = {
      score: toMover(beforeIdx, p.s),
      depth: 12,
      bestMove: p.b || '',
      pv: [],
    }
    evals[beforeIdx + 1] = {
      score: toMover(beforeIdx + 1, p.a),
      depth: 12,
      bestMove: '',
      pv: [],
    }
  }

  return {
    gameId: String(gameId),
    fmt: MASTER_ANALYSIS_FMT,
    depth: 12,
    createdAt: Date.now(),
    evals,
  }
}

/** 测试辅助 */
export function _clearStaticCache(): void {
  shardCache.clear()
}