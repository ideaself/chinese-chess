/**
 * 着法评级徽标（走法列表与棋盘角标共用）
 */
import type { MoveClassification } from './model'

export const MOVE_TAGS: Partial<Record<MoveClassification, { t: string; c: string }>> = {
  best: { t: '正', c: 'mt-best' },
  excellent: { t: '妙', c: 'mt-excellent' },
  good: { t: '好', c: 'mt-good' },
  inaccuracy: { t: '软', c: 'mt-inaccuracy' },
  mistake: { t: '次', c: 'mt-mistake' },
  blunder: { t: '劣', c: 'mt-blunder' },
  blunder2: { t: '漏', c: 'mt-blunder2' },
}

export function moveTag(cls?: MoveClassification | null): { t: string; c: string } | null {
  if (!cls) return null
  return MOVE_TAGS[cls] ?? null
}
