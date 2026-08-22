/**
 * 主变推演面板 - 计划第15节
 *
 * 在决策局面上逐步演示 AI 推荐变化，可前进/后退/跳转。
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { TriRight } from '../ui/icons'

export const VariationPanel: React.FC = () => {
  const variation = useStore(s => s.variation)
  const variationGo = useStore(s => s.variationGo)
  const exitVariation = useStore(s => s.exitVariation)

  if (!variation) return null
  const { moves, moveCns, index } = variation

  return (
    <div className="controls">
      <div className="ctrl-section">
        <div className="ctrl-title">
          主变推演 · 起于第{Math.floor(variation.basePly / 2) + 1}回合 · {index}/{moves.length}
        </div>

        <div className="transport">
          <button className="t-btn" onClick={() => variationGo(0)} title="起点">⏮</button>
          <button className="t-btn" onClick={() => variationGo(index - 1)} disabled={index <= 0} title="上一步">◀</button>
          <button className="t-btn t-main" onClick={() => variationGo(index + 1)} disabled={index >= moves.length} title="下一步"><TriRight /></button>
          <button className="t-btn" onClick={() => variationGo(moves.length)} title="终点">⏭</button>
        </div>

        {/* 变化着法列表 */}
        <div className="variation-moves">
          {moveCns.map((cn, i) => (
            <span
              key={i}
              className={`history-move ${i < index ? 'played' : ''}`}
              onClick={() => variationGo(i + 1)}
            >
              {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}{cn || `#${i + 1}`}
            </span>
          ))}
        </div>

        {index >= moves.length && (
          <div className="panel-hint">推演结束（共 {moves.length} 步）</div>
        )}
      </div>

      <div className="action-grid">
        <button className="btn btn-primary" onClick={exitVariation}>✕ 退出推演</button>
      </div>
    </div>
  )
}
