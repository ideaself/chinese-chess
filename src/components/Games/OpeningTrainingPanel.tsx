/**
 * 开局训练面板 - 计划第22节"开局训练"
 *
 * 玩家执红按定式行棋：走对继续（对手侧自动演示），
 * 走偏提示正确着法；完成后可退出或换一条线路。
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { OPENING_LINES } from '../../game/openings'

export const OpeningTrainingPanel: React.FC = () => {
  const openingTraining = useStore(s => s.openingTraining)
  const exitOpeningTraining = useStore(s => s.exitOpeningTraining)
  const startOpeningTraining = useStore(s => s.startOpeningTraining)

  const line = openingTraining ? OPENING_LINES.find(l => l.id === openingTraining.lineId) : null

  // ── 训练进行中 ──
  if (openingTraining && line) {
    const { index, status } = openingTraining
    const total = line.moves.length
    const progressPct = Math.round((index / total) * 100)

    return (
      <div className="controls">
        <div className="ctrl-section">
          <div className="ctrl-title">开局训练 · {line.name}</div>
          <div className="analysis-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-meta">
              <span>{Math.ceil(index / 2) + 1} / {Math.ceil(total / 2)} 回合</span>
            </div>
          </div>

          {/* 已走的理论着法 */}
          <div className="variation-moves">
            {line.names.slice(0, index).map((name, i) => (
              <span key={i} className="history-move played">{name}</span>
            ))}
          </div>

          {status === 'wrong' && (
            <>
              <div className="puzzle-result puzzle-wrong">✗ 偏离定式</div>
              <div className="puzzle-answer">
                此处应走：<b>{line.names[index]}{line.notes[index] ? `（${line.notes[index]}）` : ''}</b>
                <br />请重新走这一步
              </div>
            </>
          )}

          {status === 'done' && (
            <div className="puzzle-result puzzle-correct">🎉 恭喜！这条定式已完整掌握</div>
          )}

          <div className="panel-hint">
            {status === 'playing' ? '按定式走你的着法，系统会自动演示对方应手' : status === 'wrong' ? '按提示修正这一步' : '可结束训练或换一条线路'}
          </div>
        </div>

        <div className="action-grid cols-2">
          <button className="btn btn-primary" onClick={exitOpeningTraining}>✕ 结束训练</button>
          <button
            className="btn"
            onClick={() => {
              const others = OPENING_LINES.filter(l => l.id !== line.id)
              startOpeningTraining(others[Math.floor(Math.random() * others.length)].id)
            }}
          >🔄 换一条</button>
        </div>
      </div>
    )
  }

  // ── 线路选择 ──
  return (
    <div className="controls">
      <div className="ctrl-title">选择一条开局定式开始训练</div>
      <div className="training-list">
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
      <div className="panel-hint">
        训练规则：你执红按定式行棋，走对自动演示对方应手，走偏会提示正确着法。
      </div>
    </div>
  )
}
