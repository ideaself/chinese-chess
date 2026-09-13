/**
 * 关键手导航：复盘时在失误级着法之间跳转（移动端「下一关键手」）
 */
import type { Game } from './model'
import { ERROR_LEVELS } from './model'

function isKeyPly(game: Game, i: number): boolean {
  const cls = game.plies[i]?.analysis?.classification
  return !!cls && ERROR_LEVELS.includes(cls)
}

/**
 * 从当前局面（已走 fromPly 手，1-based 计数）向后找下一关键手。
 * 返回该着法的 ply 序号（1-based，可直接 goToPly）；没有则 null。
 */
export function findNextKeyPly(game: Game, fromPly: number): number | null {
  for (let i = Math.max(0, fromPly); i < game.plies.length; i++) {
    if (isKeyPly(game, i)) return i + 1
  }
  return null
}

/** 从当前局面向前找上一关键手（跳过当前局面紧邻的那一手） */
export function findPrevKeyPly(game: Game, fromPly: number): number | null {
  for (let i = Math.min(game.plies.length - 1, fromPly - 2); i >= 0; i--) {
    if (isKeyPly(game, i)) return i + 1
  }
  return null
}
