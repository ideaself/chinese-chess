/**
 * 强制取胜搜索（将死 / 困毙） - 纯规则实现，不依赖引擎
 *
 * 用途：验证残局训练预设"红方是否真的能赢"（内容质量回归）。
 *
 * 语义：`findForcedWin(state, limit)` 判断行棋方能否在 limit 手（ply）内
 * 强制将死/困毙对手，返回最少手数；找不到（或超出节点预算）返回 null。
 * 象棋中困毙同样判负，因此"对方无合法着法"即算取胜。
 */

import { boardToFen, makeMove, type BoardState } from './board'
import { getAllLegalMoves } from './rules'

export interface ForcedWin {
  /** 最少手数（ply） */
  plies: number
}

const INF = Number.POSITIVE_INFINITY

/** 搜索节点上限：超出按"未找到"处理（冷门/长杀局面不做完整证明） */
const DEFAULT_NODE_BUDGET = 300_000

interface Ctx {
  nodes: number
  budget: number
  memo: Map<string, number>
}

/** 局面键：棋盘 + 行棋方（忽略计数段，提高缓存命中） */
function posKey(state: BoardState): string {
  return boardToFen(state).split(' ').slice(0, 2).join(' ')
}

/**
 * 行棋方在 depth 手内强制取胜所需最少手数（Infinity = 不能强制取胜）
 *
 * AND-OR 搜索：我方存在一手 → 对手所有应手都无法逃脱。
 */
function winIn(state: BoardState, depth: number, ctx: Ctx): number {
  if (depth <= 0) return INF
  // 节点预算按"着法级"计数（每次走子/应手都算），否则单节点代价过高
  if (++ctx.nodes > ctx.budget) return INF

  const key = `${posKey(state)}|${depth}`
  const cached = ctx.memo.get(key)
  if (cached !== undefined) return cached

  const moves = getAllLegalMoves(state)
  // 生成应手本身也是主要开销，计入预算
  ctx.nodes += moves.length
  if (ctx.nodes > ctx.budget) return INF
  if (moves.length === 0) {
    // 轮到自己无着法 = 已被将死/困毙，不可能取胜
    ctx.memo.set(key, INF)
    return INF
  }

  let best = INF
  for (const m of moves) {
    if (++ctx.nodes > ctx.budget) return INF
    const next = makeMove(state, { ...m, turn: state.turn })
    const replies = getAllLegalMoves(next)
    ctx.nodes += replies.length
    if (ctx.nodes > ctx.budget) return INF
    if (replies.length === 0) {
      // 一步将死/困毙
      best = 1
      break
    }
    if (depth < 3) continue

    let worst = 0
    let allLose = true
    for (const r of replies) {
      if (++ctx.nodes > ctx.budget) return INF
      const after = makeMove(next, { ...r, turn: next.turn })
      const need = winIn(after, depth - 2, ctx)
      if (need === INF) { allLose = false; break }
      if (need > worst) worst = need
    }
    if (allLose && 2 + worst < best) best = 2 + worst
  }

  ctx.memo.set(key, best)
  return best
}

/** 行棋方是否能在 limit 手内强制取胜 */
export function findForcedWin(
  state: BoardState,
  limit = 9,
  nodeBudget = DEFAULT_NODE_BUDGET,
): ForcedWin | null {
  const ctx: Ctx = { nodes: 0, budget: nodeBudget, memo: new Map() }
  const plies = winIn(state, limit, ctx)
  return plies === INF ? null : { plies }
}
