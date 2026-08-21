/**
 * 战绩统计面板
 *
 * 计划第19节: 棋力统计
 *   总局数、胜、负、和、胜率、最近20局、平均分析评价
 */

import React from 'react'
import { getStats, getWeaknessAnalysis } from '../../game/storage'
import type { PlayerOutcome } from '../../game/storage'

const OUTCOME_CHAR: Record<PlayerOutcome, string> = {
  win: '胜',
  loss: '负',
  draw: '和',
}

const PHASE_NAMES: Record<string, string> = {
  opening: '开局',
  middle: '中局',
  endgame: '残局',
}

export const StatsPanel: React.FC = () => {
  const stats = getStats()
  const weakness = getWeaknessAnalysis()
  const winRate = stats.totalGames > 0 ? ((stats.wins / stats.totalGames) * 100).toFixed(1) : '0.0'

  return (
    <div className="stats-panel">
      <div className="panel-header"><h3>战绩统计</h3></div>
      <div className="panel-body">
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-value">{stats.totalGames}</div>
            <div className="stat-label">总对局</div>
          </div>
          <div className="stat-item stat-win">
            <div className="stat-value">{stats.wins}</div>
            <div className="stat-label">胜</div>
          </div>
          <div className="stat-item stat-loss">
            <div className="stat-value">{stats.losses}</div>
            <div className="stat-label">负</div>
          </div>
          <div className="stat-item stat-draw">
            <div className="stat-value">{stats.draws}</div>
            <div className="stat-label">和</div>
          </div>
        </div>
        <div className="stats-row">
          <span className="stats-label">胜率</span>
          <span className="stats-value">{winRate}%</span>
        </div>

        {stats.recentResults.length > 0 && (
          <>
            <div className="stats-label" style={{ margin: '10px 0 4px' }}>最近 {stats.recentResults.length} 局</div>
            <div className="recent-results">
              {stats.recentResults.map((r, i) => (
                <span key={i} className={`result-dot result-${r}`} title={OUTCOME_CHAR[r]}>
                  {OUTCOME_CHAR[r]}
                </span>
              ))}
            </div>
          </>
        )}

        {stats.avgMoveLoss !== null && (
          <div className="stats-row" style={{ marginTop: 8 }}>
            <span className="stats-label">平均每步损失（分析）</span>
            <span className="stats-value">{(stats.avgMoveLoss / 100).toFixed(2)} 兵</span>
          </div>
        )}

        {/* 个人弱点分析 - 计划第19节 V2 */}
        {weakness && (
          <div className="weakness-box">
            <div className="stats-label" style={{ marginBottom: 6 }}>阶段表现（基于已分析对局）</div>
            {(['opening', 'middle', 'endgame'] as const).map(phase => {
              const s = weakness[phase]
              if (s.plies === 0) return null
              const avg = (s.lossSum / s.plies / 100).toFixed(2)
              const isWeakest = weakness.weakestPhase === phase
              return (
                <div key={phase} className={`stats-row ${isWeakest ? 'weakness-worst' : ''}`}>
                  <span className="stats-label">
                    {PHASE_NAMES[phase]}{isWeakest ? ' ⚠ 最弱' : ''}
                  </span>
                  <span className="stats-value">
                    {avg} 兵/步 · {s.errors} 失误
                  </span>
                </div>
              )
            })}
            {weakness.weakestPhase && (
              <div className="panel-hint" style={{ marginTop: 6 }}>
                你的{PHASE_NAMES[weakness.weakestPhase]}是当前短板，建议多复盘该阶段的失误。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
