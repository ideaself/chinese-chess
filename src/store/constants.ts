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

/**
 * 拟人降强层（该 Pikafish 构建不含官方 Skill Level/UCI_Elo，故用此模拟）。
 * - p: 以该概率不走最优着法，而从 topN 候选里按权重选一手（越弱越常“失误”）
 * - topN: 候选范围（权重随名次递减，失误也多为“次优”而非送子）
 * 大师/特级大师 p=0，始终走引擎最优着法。
 */
export const DIFFICULTY_SKILL: Record<Difficulty, { p: number; topN: number }> = {
  beginner: { p: 0.6, topN: 5 },
  easy: { p: 0.38, topN: 4 },
  medium: { p: 0.15, topN: 3 },
  hard: { p: 0.05, topN: 2 },
  master: { p: 0.0, topN: 1 },
  grandmaster: { p: 0.0, topN: 1 },
}

/**
 * AI 每手时间预算（毫秒）。单线程 WASM 引擎按深度搜索在高级别会极慢甚至长时间不返回，
 * 故对局改用「时间预算」驱动（go movetime），保证尽快落子、UI 不卡死。
 * 难度越高预算越大（更深的搜索在给定时间内完成）。
 */
export const DIFFICULTY_MOVE_TIME: Record<Difficulty, number> = {
  beginner: 300,
  easy: 700,
  medium: 1200,
  hard: 2000,
  master: 3000,
  grandmaster: 18000,
}

/** 顶部评估条快评的时间上限（毫秒）。单线程引擎同一时刻只能跑一次搜索，
 * 快评若不限时会在高级别占住引擎数秒，与下一步 AI 搜索交叠产生串扰。 */
export const QUICK_EVAL_MOVE_TIME = 900

/** 移动端覆盖层 key: 用户主动回到纯棋盘主页 */
export const BOARD_HOME = '__board__'


