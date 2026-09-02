/**
 * 数据洞察面板 - 141k 局棋谱统计分析
 *
 * 三块内容:
 *   - 开局体系: 局数 / 红方得分率 / 失误率
 *   - 最稳健棋手: 失误率排行（低失误 = 稳健）
 *   - 失误集锦: 精选严重失误，点击进入题目训练
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import {
  loadInsights, getInsights,
  type InsightsData, type MistakeCollection,
} from '../../game/insights'

const PAGE_SIZE = 40

export const InsightsPanel: React.FC = () => {
  const startLibraryPuzzle = useStore(s => s.startLibraryPuzzle)
  const setSheetTab = useStore(s => s.setSheetTab)
  const setTab = useStore(s => s.setTab)
  const [data, setData] = useState<InsightsData | null>(null)
  const [error, setError] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    loadInsights()
      .then(ok => { if (ok) setData(getInsights()) })
      .catch(e => setError(`洞察数据加载失败: ${e.message}`))
  }, [])

  const openMistake = (m: MistakeCollection) => {
    const turn = m.fen.split(' ')[1] === 'b' ? 'b' : 'w'
    startLibraryPuzzle({
      type: '失误题',
      game_id: 0,
      ply: m.ply,
      fen: m.fen,
      move_uci: m.move,
      best_move: m.best,
      score_before: 0,
      score_drop: m.drop,
      result: m.result,
      event: m.event,
      red: m.red,
      black: m.black,
    })
    setTab('play')
    setSheetTab('puzzle')
  }

  const loadMore = useCallback(() => {
    setVisibleCount(prev => prev + PAGE_SIZE)
  }, [])

  if (error) {
    return <div className="panel-hint" style={{ padding: 24 }}>{error}</div>
  }
  if (!data) {
    return <div className="panel-hint" style={{ padding: 24 }}>洞察数据加载中…</div>
  }

  const { stats, mistakeCollection } = data

  return (
    <div className="master-library">
      <div className="panel-header">
        <h3>📊 数据洞察</h3>
        <span style={{ fontSize: 12, color: '#888' }}>
          {stats.games.toLocaleString()} 局 · {data.source}
        </span>
      </div>

      {/* 开局体系 */}
      <div className="ctrl-title" style={{ marginBottom: 8 }}>♟ 开局体系</div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
        <div style={{ display: 'flex', padding: '2px 0', fontWeight: 600 }}>
          <span style={{ flex: 1 }}>体系</span>
          <span style={{ width: 64, textAlign: 'right' }}>局数</span>
          <span style={{ width: 72, textAlign: 'right' }}>红方得分率</span>
          <span style={{ width: 64, textAlign: 'right' }}>失误率</span>
        </div>
        {stats.openings.slice(0, 12).map(o => (
          <div key={o.system} style={{ display: 'flex', padding: '2px 0' }}>
            <span style={{ flex: 1 }}>{o.system}</span>
            <span style={{ width: 64, textAlign: 'right' }}>{o.n.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right' }}>{o.redScore}%</span>
            <span style={{ width: 64, textAlign: 'right' }}>{o.mistakeRate}%</span>
          </div>
        ))}
      </div>

      {/* 最稳健棋手 */}
      <div className="ctrl-title" style={{ marginBottom: 8, marginTop: 12 }}>🏆 最稳健棋手（失误率最低）</div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
        <div style={{ display: 'flex', padding: '2px 0', fontWeight: 600 }}>
          <span style={{ flex: 1 }}>棋手</span>
          <span style={{ width: 64, textAlign: 'right' }}>着数</span>
          <span style={{ width: 72, textAlign: 'right' }}>失误率</span>
          <span style={{ width: 64, textAlign: 'right' }}>严重失误</span>
        </div>
        {stats.players.slice(0, 10).map(p => (
          <div key={p.name} style={{ display: 'flex', padding: '2px 0' }}>
            <span style={{ flex: 1 }}>{p.name}</span>
            <span style={{ width: 64, textAlign: 'right' }}>{p.moves.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right' }}>{p.mistakeRate}%</span>
            <span style={{ width: 64, textAlign: 'right' }}>{p.blunderRate}%</span>
          </div>
        ))}
      </div>

      {/* 失误集锦 */}
      <div className="ctrl-title" style={{ marginBottom: 8, marginTop: 12 }}>
        💥 大师失误集锦（点击挑战找最佳着）
      </div>
      <div className="training-list">
        {mistakeCollection.slice(0, visibleCount).map((m, i) => (
          <div key={i} className="training-item">
            <div className="training-info">
              <div className="training-name">
                {m.mover} 失误（掉 {m.drop}cp）· {m.event || '佚名赛事'}
              </div>
              <div className="training-desc">
                {m.red} vs {m.black} · 第 {m.ply} 手
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px', flexShrink: 0 }}
              onClick={() => openMistake(m)}
            >挑战</button>
          </div>
        ))}
      </div>
      {visibleCount < mistakeCollection.length && (
        <button className="btn btn-sm" style={{ marginTop: 8, alignSelf: 'center' }}
          onClick={loadMore}>
          加载更多（{visibleCount}/{mistakeCollection.length}）
        </button>
      )}
    </div>
  )
}