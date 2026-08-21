/**
 * 错题本 - 计划第17节 V2
 *
 * 从已分析棋谱中提取玩家失误，可发起重走训练。
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { getMistakes } from '../../game/storage'

const LABELS: Record<string, { icon: string; text: string }> = {
  mistake: { icon: '⚠️', text: '疑问' },
  blunder: { icon: '❌', text: '失误' },
  blunder2: { icon: '❌❌', text: '严重失误' },
}

export const MistakeBook: React.FC = () => {
  const startPuzzleFromGame = useStore(s => s.startPuzzleFromGame)
  const loadGame = useStore(s => s.loadGame)
  const setTab = useStore(s => s.setTab)
  const mistakes = getMistakes()

  if (mistakes.length === 0) {
    return (
      <div className="mistake-book">
        <div className="panel-hint">
          还没有错题。完成整盘分析后，你的失误会自动收录到这里。
        </div>
      </div>
    )
  }

  return (
    <div className="mistake-book">
      <div className="panel-hint" style={{ marginBottom: 8 }}>
        共 {mistakes.length} 道错题（最多保留 50 条），点击"重走"重新挑战
      </div>
      <div className="key-moments-list">
        {mistakes.map((m, i) => {
          const label = LABELS[m.classification] ?? LABELS.mistake
          return (
            <div key={`${m.gameId}-${m.plyIndex}`} className="key-moment-row">
              <span className="key-moment-icon">{label.icon}</span>
              <span className="key-moment-round">第{m.round}回合</span>
              <span className="key-moment-label">{label.text}</span>
              <span className="key-moment-detail">
                {m.moveCn}
                {m.bestMoveCn && m.bestMoveCn !== m.moveCn ? ` → 应走 ${m.bestMoveCn}` : ''}
              </span>
              <button
                className="btn btn-sm key-moment-retry"
                onClick={() => startPuzzleFromGame(m.gameId, m.plyIndex)}
              >重走</button>
              <button
                className="btn btn-sm"
                style={{ padding: '3px 8px', fontSize: 12 }}
                onClick={() => { loadGame(m.gameId); setTab('analysis') }}
              >查看</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
