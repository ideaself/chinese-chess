/**
 * 局面评估条 - 天天象棋式
 *
 * 棋盘正上方的横向比例条：左侧红色代表红方优势，右侧黑色代表黑方优势，
 * 哪方占优哪方更长。数据来自引擎快速评估（行棋方视角 → 转红方视角）。
 */

import React, { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { boardToFen } from '../../game/board'

/** 评估分（厘兵，红方视角）→ 红色段占比(%) */
export function evalToRedPct(scoreRed: number): number {
  const abs = Math.abs(scoreRed)
  if (abs >= 100000) return scoreRed >= 0 ? 96 : 4 // 杀棋
  const clamped = Math.max(-600, Math.min(600, scoreRed))
  return Math.max(4, Math.min(96, 50 + (clamped / 600) * 46))
}

export const EvalBar: React.FC = () => {
  const board = useStore(s => s.board)
  const mode = useStore(s => s.mode)
  const evalBar = useStore(s => s.evalBar)
  const analysis = useStore(s => s.analysis)

  const curFen = useMemo(() => {
    // 仅取前两段做比较（计数器不影响局面）
    try { return boardToFen(board).split(' ').slice(0, 2).join(' ') } catch { return '' }
  }, [board])

  // 数据源: evalBar 优先（对战自动评估），其次单局面分析
  const source = useMemo(() => {
    if (evalBar && evalBar.fen.split(' ').slice(0, 2).join(' ') === curFen) return evalBar.score
    if (analysis && analysis.fen.split(' ').slice(0, 2).join(' ') === curFen) return analysis.score
    return null
  }, [evalBar, analysis, curFen])

  if (mode !== 'play' && mode !== 'replay') return null

  // 转红方视角: 行棋方为黑时取负
  const scoreRed = source === null ? 0 : (board.turn === 'w' ? source : -source)
  const redPct = evalToRedPct(scoreRed)
  const label = source === null
    ? '—'
    : Math.abs(scoreRed) >= 100000
      ? (scoreRed >= 0 ? '红杀' : '黑杀')
      : `${scoreRed >= 0 ? '+' : '−'}${Math.abs(scoreRed / 100).toFixed(1)}`

  return (
    <div className="eval-bar" title="局面评估（点击可刷新分析）">
      <div className="eval-bar-track">
        <div className="eval-bar-red" style={{ width: `${redPct}%` }} />
        <div className="eval-bar-black" style={{ width: `${100 - redPct}%` }} />
        <div className="eval-bar-notch" />
      </div>
      <span className={`eval-bar-label ${scoreRed >= 0 ? 'label-red' : 'label-black'}`}>
        {label}
      </span>
    </div>
  )
}
