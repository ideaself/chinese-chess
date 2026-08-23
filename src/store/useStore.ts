/**
 * 应用状态管理 (Zustand)
 *
 * 严格遵循计划文档的对局流程:
 *   开始对局 → 人机对战 → 自动保存棋谱 → 查看棋谱 → AI 分析
 *
 * 本文件仅负责组合 slices；领域逻辑见 ./slices/*，
 * 类型见 ./types.ts，难度常量见 ./constants.ts，纯函数见 ./helpers.ts。
 */

import { create } from 'zustand'
import type { AppState } from './types'
import { createUiSlice } from './slices/uiSlice'
import { createEngineSlice } from './slices/engineSlice'
import { createGameSlice } from './slices/gameSlice'
import { createMasterQuizSlice } from './slices/masterQuizSlice'
import { createPuzzleSlice } from './slices/puzzleSlice'
import { createVariationSlice } from './slices/variationSlice'
import { createSetupSlice } from './slices/setupSlice'
import { createOpeningSlice } from './slices/openingSlice'

export const useStore = create<AppState>((set, get) => ({
  ...createUiSlice(set, get),
  ...createEngineSlice(set, get),
  ...createGameSlice(set, get),
  ...createMasterQuizSlice(set, get),
  ...createPuzzleSlice(set, get),
  ...createVariationSlice(set, get),
  ...createSetupSlice(set, get),
  ...createOpeningSlice(set, get),
}))

export { DIFFICULTY_LABELS } from './constants'
export * from './types'
