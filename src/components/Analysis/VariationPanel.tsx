/**
 * 主变推演面板 — 多分支树 + 引擎评分对比（仿爱棋谱「分支变化」）
 *
 * - 棋盘上试走可形成多个并列分支，点击分支切换
 * - 每个分支逐手显示引擎评估（厘兵，走棋方视角），与主变对比着色
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { TriRight } from '../ui/icons'
import type { BranchLine, VariationState } from '../../store/types'

function fmtScore(score: number | null): string {
  if (score == null) return '—'
  const v = score / 100
  return (v >= 0 ? '+' : '') + v.toFixed(2)
}

/** 评估着色：与主变同位局面对比，优绿劣红 */
function evalClass(branchEval: number | null, mainEval: number | null): string {
  if (branchEval == null) return 'ev-none'
  if (mainEval == null) return 'ev-raw'
  const d = branchEval - mainEval
  if (d > 15) return 'ev-better'
  if (d < -15) return 'ev-worse'
  return 'ev-even'
}

export const VariationPanel: React.FC = () => {
  const variation = useStore(s => s.variation) as VariationState | null
  const variationGo = useStore(s => s.variationGo)
  const variationSelectBranch = useStore(s => s.variationSelectBranch)
  const exitVariation = useStore(s => s.exitVariation)

  if (!variation) return null
  const { basePly, mainLine, branches, currentId, currentPly, evaluating } = variation

  const current = currentId === null ? mainLine : branches.find(b => b.id === currentId)
  const moves = current?.moves ?? []
  const moveCns = current?.moveCns ?? []
  const evals = current?.evals ?? []

  const branchRows: { id: string; label: string; line: BranchLine | null }[] = []
  if (mainLine) branchRows.push({ id: 'main', label: '主变', line: mainLine })
  branches.forEach((b, i) => branchRows.push({ id: b.id, label: `分支${i + 1}`, line: b }))

  const turnNo = Math.floor(basePly / 2) + 1

  return (
    <div className="controls">
      <div className="ctrl-section">
        <div className="ctrl-title">
          主变推演 · 起于第{turnNo}回合 · {branchRows.length} 条分支
          {evaluating && <span className="eval-busy"> · 引擎评测中…</span>}
        </div>

        {/* 分支列表（可切换 + 评分对比） */}
        <div className="branch-list">
          {branchRows.map(row => {
            const line = row.line
            if (!line) return null
            const isCurrent = (row.id === 'main' && currentId === null) || row.id === currentId
            const lastIdx = line.moves.length - 1
            const mainEval = mainLine ? (mainLine.evals[lastIdx] ?? null) : null
            const branchEval = line.evals[lastIdx] ?? null
            const cls = row.id === 'main' ? 'ev-raw' : evalClass(branchEval, mainEval)
            return (
              <button
                key={row.id}
                className={`branch-row ${isCurrent ? 'branch-current' : ''}`}
                onClick={() => variationSelectBranch(row.id)}
              >
                <span className="branch-name">{row.label}</span>
                <span className="branch-div">自第{line.divergePly + 1}手分歧</span>
                <span className={`branch-eval ${cls}`}>{fmtScore(branchEval)}</span>
              </button>
            )
          })}
        </div>

        {/* 当前变化着法列表（逐手评分） */}
        <div className="variation-moves">
          {moves.map((_, i) => {
            const mainEval = mainLine ? (mainLine.evals[i] ?? null) : null
            const cls = currentId === null ? 'ev-raw' : evalClass(evals[i] ?? null, mainEval)
            return (
              <span
                key={i}
                className={`history-move ${i < currentPly ? 'played' : ''} ${i === currentPly - 1 ? 'cur' : ''}`}
                onClick={() => variationGo(i + 1)}
              >
                {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}{moveCns[i] || `#${i + 1}`}
                <span className={`move-eval ${cls}`}>{fmtScore(evals[i] ?? null)}</span>
              </span>
            )
          })}
        </div>

        {moves.length === 0 && (
          <div className="panel-hint">在棋盘上点击棋子落子，试走你的变化；同局面走不同手会形成新分支</div>
        )}
        {currentPly >= moves.length && moves.length > 0 && (
          <div className="panel-hint">推演结束（共 {moves.length} 步）· 回退后改走另一手形成新分支</div>
        )}
      </div>

      <div className="action-grid">
        <button className="btn btn-primary" onClick={exitVariation}>✕ 退出推演 · 回到主线</button>
      </div>
    </div>
  )
}
