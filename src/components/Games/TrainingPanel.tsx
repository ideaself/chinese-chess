/**
 * 训练面板 - 计划第22节 V2"残局训练"
 *
 * 经典必胜残局 vs 引擎防守，练习杀王技巧。
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { ENDGAME_PRESETS } from '../../game/endgames'

export const TrainingPanel: React.FC = () => {
  const startEndgameTraining = useStore(s => s.startEndgameTraining)
  const engineReady = useStore(s => s.engineReady)

  return (
    <div className="training-panel">
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
