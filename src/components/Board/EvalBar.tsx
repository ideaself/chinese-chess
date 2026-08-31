/**
 * 局面评估条 - 天天象棋式
 *
 * 棋盘正上方的横向比例条：左侧红色代表红方优势，右侧黑色代表黑方优势，
 * 哪方占优哪方更长。数据来自引擎快速评估（行棋方视角 → 转红方视角）。
 * 顶部同时显示 评分 / 深度 / 广度(节点) / 速度(节点每秒)。
 */

import React, { useMemo, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { boardToFen } from '../../game/board'

/** 评估分（厘兵，红方视角）→ 红色段占比(%)：tanh 压缩，平滑饱和 */
export function evalToRedPct(scoreRed: number): number {
  const abs = Math.abs(scoreRed)
  if (abs >= 100000) return scoreRed >= 0 ? 96 : 4 // 杀棋
  // 以 ±1200 厘兵(±12 兵)为半饱和尺度：普通局面(±4)约占 1/3~2/3，
  // 仅大优/被杀才逼近两端，避免小幅摆动看起来像崩盘
  const p = Math.tanh(scoreRed / 1200)
  return Math.max(4, Math.min(96, 50 + p * 46))
}

function fmtNodes(n?: number): string {
  if (!n) return '—'
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return String(n)
}

function fmtNps(n?: number): string {
  if (!n) return '—'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k/s'
  return n + '/s'
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

  // 保留上一次有效评估，用于局面切换时避免分数条归零（保持连贯）
  const last = useRef<{ scoreRed: number; redPct: number; label: string; depth?: number; nodes?: number; nps?: number } | null>(null)

  // 数据源: evalBar 优先（对战自动评估），其次单局面分析
  const src = useMemo(() => {
    if (evalBar && evalBar.fen.split(' ').slice(0, 2).join(' ') === curFen) {
      return { score: evalBar.score, depth: evalBar.depth, nodes: evalBar.nodes, nps: evalBar.nps }
    }
    if (analysis && analysis.fen.split(' ').slice(0, 2).join(' ') === curFen) {
      return { score: analysis.score, depth: analysis.depth, nodes: undefined, nps: undefined }
    }
    return null
  }, [evalBar, analysis, curFen])

  if (mode !== 'play' && mode !== 'replay') return null

  // 转红方视角: 行棋方为黑时取负
  const live = src !== null
  const rawScoreRed = live ? (board.turn === 'w' ? src!.score : -src!.score) : (last.current?.scoreRed ?? 0)
  const redPct = live ? evalToRedPct(rawScoreRed) : (last.current?.redPct ?? 50)
  const label = live
    ? (Math.abs(rawScoreRed) >= 100000
        ? (rawScoreRed >= 0 ? `红杀 ${rawScoreRed - 100000} 步` : `黑杀 ${-rawScoreRed - 100000} 步`)
        : `${rawScoreRed >= 0 ? '红优' : '黑优'}${Math.abs(Math.round(rawScoreRed))}分`)
    : (last.current?.label ?? '—')
  const depth = live ? src!.depth : last.current?.depth
  const nodes = live ? src!.nodes : last.current?.nodes
  const nps = live ? src!.nps : last.current?.nps

  // 评分切换时保留上一次的显示值，避免局面变化时分数条归零造成的不连贯
  if (live) {
    last.current = { scoreRed: rawScoreRed, redPct, label, depth, nodes, nps }
  }

  return (
    <div className="eval-bar" title="局面评估（点击可刷新分析）">
      <div className="eval-bar-track">
        <div className="eval-bar-red" style={{ width: `${redPct}%` }} />
        <div className="eval-bar-black" style={{ width: `${100 - redPct}%` }} />
        <div className="eval-bar-notch" />
      </div>
      <div className="eval-bar-meta">
        <span className={`eval-score ${rawScoreRed >= 0 ? 'label-red' : 'label-black'}`}>{label}</span>
        <span className="eval-meta">深度 {depth ?? '—'}</span>
        <span className="eval-meta">广度 {fmtNodes(nodes)}</span>
        <span className="eval-meta">速度 {fmtNps(nps)}</span>
      </div>
    </div>
  )
}
