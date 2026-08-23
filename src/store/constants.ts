/** 难度配置（自 useStore.ts 拆出） */
import type { Difficulty } from "./types"
// ── 难度配置 ──────────────────────────────────────────────────────

export const DIFFICULTY_DEPTH: Record<Difficulty, number> = {
  beginner: 2,
  easy: 4,
  medium: 10,
  hard: 16,
  master: 20,
  grandmaster: 28,
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: '入门',
  easy: '初级',
  medium: '中级',
  hard: '高级',
  master: '大师',
  grandmaster: '特级大师',
}


