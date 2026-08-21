/**
 * 错题本 - 计划第17节 V2
 *
 * 从已分析棋谱中提取玩家失误（同局面同着法去重），
 * 支持"已掌握"标记与筛选，可发起重走训练。
 */

import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import { getMistakes, getMasteredKeys, toggleMastered } from '../../game/storage'

const LABELS: Record<string, { icon: string; text: string }> = {
  mistake: { icon: '⚠️', text: '疑问' },
  blunder: { icon: '❌', text: '失误' },
  blunder2: { icon: '❌❌', text: '严重失误' },
}

type Filter = 'todo' | 'mastered' | 'all'

export const MistakeBook: React.FC = () => {
  const startPuzzleFromGame = useStore(s => s.startPuzzleFromGame)
  const loadGame = useStore(s => s.loadGame)
  const setTab = useStore(s => s.setTab)
  const showToast = useStore(s => s.showToast)

  const [filter, setFilter] = useState<Filter>('todo')
  const [version, setVersion] = useState(0) // 切换掌握状态后强制刷新

  const all = getMistakes()
  const masteredKeys = getMasteredKeys()
  const mistakes = all.filter(m =>
    filter === 'all' ? true : filter === 'mastered' ? masteredKeys.has(m.key) : !masteredKeys.has(m.key),
  )

  if (all.length === 0) {
    return (
      <div className="mistake-book">
        <div className="panel-hint">
          还没有错题。完成整盘分析后，你的失误会自动收录到这里。
        </div>
      </div>
    )
  }

  const masteredCount = all.filter(m => masteredKeys.has(m.key)).length

  return (
    <div className="mistake-book" key={version}>
      <div className="mistake-header">
        <div className="key-moments-filter">
          {([['todo', `待练习 ${all.length - masteredCount}`], ['mastered', `已掌握 ${masteredCount}`], ['all', `全部 ${all.length}`]] as [Filter, string][]).map(([k, label]) => (
            <button
              key={k}
              className={`filter-btn ${filter === k ? 'btn-active' : ''}`}
              onClick={() => setFilter(k)}
            >{label}</button>
          ))}
        </div>
      </div>

      {mistakes.length === 0 ? (
        <div className="panel-hint" style={{ padding: '14px 0', textAlign: 'center' }}>
          {filter === 'todo' ? '太棒了，没有待练习的错题！' : '该类别下暂无错题'}
        </div>
      ) : (
        <div className="key-moments-list">
          {mistakes.map(m => {
            const label = LABELS[m.classification] ?? LABELS.mistake
            const isMastered = masteredKeys.has(m.key)
            return (
              <div
                key={`${m.gameId}-${m.plyIndex}`}
                className={`key-moment-row ${isMastered ? 'mastered-row' : ''}`}
              >
                <span className="key-moment-icon">{label.icon}</span>
                <span className="key-moment-round">第{m.round}回合</span>
                <span className="key-moment-label">{label.text}</span>
                <span className="key-moment-detail">
                  {m.moveCn}
                  {m.bestMoveCn && m.bestMoveCn !== m.moveCn ? ` → 应走 ${m.bestMoveCn}` : ''}
                </span>
                {!isMastered && (
                  <button
                    className="btn btn-sm key-moment-retry"
                    onClick={() => startPuzzleFromGame(m.gameId, m.plyIndex)}
                  >重走</button>
                )}
                <button
                  className="btn btn-sm"
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => {
                    toggleMastered(m.key)
                    setVersion(v => v + 1)
                    showToast(isMastered ? '已移回待练习' : '已标记为掌握 ✓')
                  }}
                  title={isMastered ? '取消掌握' : '标记为已掌握'}
                >
                  {isMastered ? '↩' : '✓'}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => { loadGame(m.gameId); setTab('analysis') }}
                >查看</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
