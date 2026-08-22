/**
 * 训练面板 - 计划第22节"残局训练 / 开局训练"
 *
 * 两个板块:
 *   - 开局定式: 玩家执红按理论行棋，走偏提示
 *   - 残局练习: 经典必胜局面 vs 引擎防守
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { ENDGAME_PRESETS } from '../../game/endgames'
import { OPENING_LINES } from '../../game/openings'

export const TrainingPanel: React.FC = () => {
  const startEndgameTraining = useStore(s => s.startEndgameTraining)
  const startOpeningTraining = useStore(s => s.startOpeningTraining)
  const engineReady = useStore(s => s.engineReady)

  return (
    <div className="training-panel">
      {/* ── 开局训练 ── */}
      <div className="ctrl-title" style={{ marginBottom: 8 }}>♟ 开局定式训练</div>
      <div className="training-list" style={{ marginBottom: 16 }}>
        {OPENING_LINES.map(l => (
          <div key={l.id} className="training-item">
            <div className="training-info">
              <div className="training-name">{l.name}</div>
              <div className="training-desc">{l.desc}</div>
            </div>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px', flexShrink: 0 }}
              onClick={() => startOpeningTraining(l.id)}
            >开始</button>
          </div>
        ))}
      </div>

      {/* ── 残局训练 ── */}
      <div className="ctrl-title" style={{ marginBottom: 8 }}>♛ 残局杀王练习</div>
      <div className="panel-hint" style={{ marginBottom: 8 }}>
        选择一个经典残局，你执红先行，引擎执黑防守。
      </div>
      <div className="training-list">
        {ENDGAME_PRESETS.map(p => (
          <div key={p.id} className="training-item">
            <div className="training-info">
              <div className="training-name">{p.name}</div>
              <div className="training-desc">{p.desc}</div>
            </div>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px', flexShrink: 0 }}
              disabled={!engineReady}
              onClick={() => startEndgameTraining(p.fen, p.name)}
            >开始</button>
          </div>
        ))}
      </div>
    </div>
  )
}
