/**
 * 战绩统计面板
 *
 * 计划第19节: 棋力统计
 *   总局数、胜、负、和、胜率、最近20局、平均分析评价
 */

import React, { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { getStats, getWeaknessAnalysis, getMistakes, getAllGames } from '../../game/storage'
import type { PlayerOutcome } from '../../game/storage'
import { generateTrainingPlan } from '../../game/training'
import { getRatingState, getRank, resetRating } from '../../game/rating'

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
  const winRateNum = stats.totalGames > 0 ? (stats.wins / stats.totalGames) * 100 : 0
  const setTab = useStore(s => s.setTab)
  const setGamesSubTab = useStore(s => s.setGamesSubTab)
  /** 棋力分版本号：终局结算后刷新卡片 */
  const ratingVersion = useStore(s => s.lastRatingChange?.after)

  // 棋力分状态（结算/重置后刷新）
  const [refresh, setRefresh] = useState(0)
  const ratingState = useMemo(() => getRatingState(), [refresh, ratingVersion])
  const rank = useMemo(() => getRank(ratingState.rating), [ratingState])

  // 个人训练计划（规划 V3: 弱点 → 行动清单）
  const plan = useMemo(() => {
    const games = getAllGames()
    const unanalyzed = games.filter(
      g => g.analysisStatus !== 'complete' && (g.header.Red === '玩家' || g.header.Black === '玩家'),
    ).length
    return generateTrainingPlan(weakness, getMistakes(), unanalyzed, winRateNum, stats.totalGames)
  }, [weakness, winRateNum, stats.totalGames])

  const goAction = (type: string) => {
    if (type === 'retry-mistakes') { setGamesSubTab('mistakes'); setTab('games') }
    else if (type === 'endgame-training' || type === 'opening-training') { setGamesSubTab('training'); setTab('games') }
    else { setGamesSubTab('list'); setTab('games') }
  }

  const winRate = stats.totalGames > 0 ? winRateNum.toFixed(1) : '0.0'

  return (
    <div className="stats-panel">
      <div className="panel-header"><h3>战绩统计</h3></div>
      <div className="panel-body">
        {/* 棋力等级 - 计划19节 V3 */}
        <RatingCard
          rating={ratingState.rating}
          rank={rank}
          games={ratingState.history.length}
          history={ratingState.history.map(h => h.after)}
          onChanged={() => setRefresh(r => r + 1)}
        />

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

        {/* 我的训练计划 - 规划 V3 */}
        {plan && plan.items.length > 0 && (
          <div className="training-plan-box">
            <div className="stats-label" style={{ marginBottom: 8 }}>📋 我的训练计划</div>
            {plan.items.map((item, i) => (
              <div key={i} className="plan-item">
                <div className="plan-item-title">{item.title}</div>
                <div className="plan-item-reason">{item.reason}</div>
                <button
                  className="btn btn-sm"
                  onClick={() => goAction(item.action.type)}
                >{item.actionLabel} →</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 棋力等级卡片（Elo + 段位 + 趋势） */
const RatingCard: React.FC<{
  rating: number
  rank: ReturnType<typeof getRank>
  games: number
  history: number[]
  onChanged: () => void
}> = ({ rating, rank, games, history, onChanged }) => {
  const [confirmReset, setConfirmReset] = useState(false)
  const showToast = useStore(s => s.showToast)

  const trend = history.length >= 2 ? history[history.length - 1] - history[0] : null

  const handleReset = () => {
    resetRating()
    setConfirmReset(false)
    showToast('棋力分已重置为初始分')
    onChanged()
  }

  return (
    <div className="rating-card">
      <div className="rating-top">
        <div>
          <div className="rating-value">{rating}</div>
          <div className="rating-sub">棋力分 · 已结算 {games} 局</div>
        </div>
        <span className="rank-badge">{rank.tier.name}</span>
      </div>

      <div className="rank-progress">
        <div className="rank-progress-fill" style={{ width: `${Math.round(rank.progress * 100)}%` }} />
      </div>
      {rank.next ? (
        <div className="panel-hint">
          距「{rank.next.name}」还需 {rank.toNext} 分
          {trend !== null && (
            <span style={{ color: trend > 0 ? 'var(--green)' : trend < 0 ? 'var(--red)' : undefined }}>
              {' '}· 近期{trend > 0 ? '+' : ''}{trend}
            </span>
          )}
        </div>
      ) : (
        <div className="panel-hint">已达最高段位</div>
      )}

      {/* 分数走势（最近结算记录，旧→新） */}
      {history.length >= 2 && (
        <svg className="sparkline" viewBox="0 0 100 28" preserveAspectRatio="none">
          <polyline
            points={sparkPoints(history)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      {games > 0 && (
        confirmReset ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn btn-sm" onClick={handleReset}>确认重置</button>
            <button className="btn btn-sm" onClick={() => setConfirmReset(false)}>取消</button>
          </div>
        ) : (
          <button className="link-btn" onClick={() => setConfirmReset(true)}>重置棋力分</button>
        )
      )}
    </div>
  )
}

/** 折线点位：归一到 0..100 × 4..24 */
function sparkPoints(values: number[]): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100
    const y = 24 - ((v - min) / span) * 20
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}
