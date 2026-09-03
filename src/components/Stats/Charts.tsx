/**
 * 战绩统计可视化（v1.21）
 *   - WinRateTrend: 累计胜率走势（旧→新）
 *   - PhaseLossBars: 开局/中局/残局平均损失横向条形图
 */

import React from 'react'
import type { PlayerOutcome, WeaknessAnalysis } from '../../game/storage'

const OUTCOME_VALUE: Record<PlayerOutcome, number> = { win: 1, loss: 0, draw: 0.5 }

/** 累计胜率走势：传入对局结果（新→旧），内部转为旧→新累计值 */
export const WinRateTrend: React.FC<{ outcomes: PlayerOutcome[] }> = ({ outcomes }) => {
  if (outcomes.length < 3) return null
  const chrono = [...outcomes].reverse()
  let games = 0
  let score = 0
  const rate: number[] = chrono.map((o) => {
    games++
    score += OUTCOME_VALUE[o]
    return (score / games) * 100
  })

  const min = Math.min(...rate, 0)
  const max = Math.max(...rate, 100)
  const span = max - min || 1
  const pts = rate.map((v, i) => {
    const x = (i / (rate.length - 1)) * 100
    const y = 26 - ((v - min) / span) * 22
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const last = rate[rate.length - 1]

  return (
    <div className="stats-chart-box">
      <div className="stats-label" style={{ marginBottom: 4 }}>
        胜率走势 <span className="stats-value" style={{ float: 'right' }}>累计 {last.toFixed(0)}%</span>
      </div>
      <svg className="sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" style={{ height: 44 }}>
        <polyline
          points={pts}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="panel-hint">按对局时间累计（含和棋 0.5 分），共 {rate.length} 局</div>
    </div>
  )
}

const PHASE_NAMES: Record<string, string> = { opening: '开局', middle: '中局', endgame: '残局' }

/** 阶段平均损失条形图 */
export const PhaseLossBars: React.FC<{ weakness: WeaknessAnalysis }> = ({ weakness }) => {
  const rows = (['opening', 'middle', 'endgame'] as const)
    .map(phase => {
      const s = weakness[phase]
      return { phase, avg: s.plies > 0 ? s.lossSum / s.plies / 100 : 0, errors: s.errors, plies: s.plies }
    })
    .filter(r => r.plies > 0)
  if (rows.length === 0) return null
  const maxAvg = Math.max(...rows.map(r => r.avg), 0.01)

  return (
    <div className="stats-chart-box" style={{ marginTop: 10 }}>
      <div className="stats-label" style={{ marginBottom: 6 }}>阶段平均损失（兵/步）</div>
      {rows.map(r => {
        const isWeakest = weakness.weakestPhase === r.phase
        return (
          <div key={r.phase} className="phase-bar-row">
            <span className="phase-bar-label">{PHASE_NAMES[r.phase]}{isWeakest ? ' ⚠' : ''}</span>
            <div className="phase-bar-track">
              <div
                className="phase-bar-fill"
                style={{
                  width: `${Math.max(4, Math.round((r.avg / maxAvg) * 100))}%`,
                  background: isWeakest ? 'var(--red, #e05555)' : 'var(--accent)',
                }}
              />
            </div>
            <span className="phase-bar-value">{r.avg.toFixed(2)}</span>
          </div>
        )
      })}
    </div>
  )
}
