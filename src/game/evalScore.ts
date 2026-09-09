/**
 * 引擎评估分视角统一
 *
 * 引擎（Pikafish / UCI）返回的 score 是**行棋方视角**：正分表示行棋方占优。
 * 界面上除了评估条（EvalBar）与局势图（EvalCurve）外，其余位置一律按
 * **红方视角**展示，转换必须走这里。
 *
 * 历史 bug：`AnalysisPanel` / `CoachPanel` 直接把行棋方视角的分当红方视角渲染，
 * 黑方行棋时"红优/黑优"整体颠倒；AI 教练的评估前提也随之反了。
 */

export type EvalSide = 'w' | 'b'

/** 行棋方视角分 → 红方视角分 */
export function toRedScore(score: number, turn: EvalSide | string): number {
  return turn === 'b' ? -score : score
}

/** 从 FEN 取行棋方（缺省视为红方） */
export function fenTurn(fen: string): EvalSide {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

/** FEN + 行棋方视角分 → 红方视角分 */
export function redScoreFromFen(score: number, fen: string): number {
  return toRedScore(score, fenTurn(fen))
}
