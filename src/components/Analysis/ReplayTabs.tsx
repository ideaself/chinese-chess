/**
 * 复盘分析 Tab 区（仿天天象棋分析页）：局势图 | 分析 | 报告
 * 移动端复盘模式下常驻于棋盘下方。
 */
import React, { useState } from 'react'
import { EvalCurve } from './EvalCurve'
import { KeyMoments } from './KeyMoments'
import { ReportPanel } from './ReportPanel'
import { useStore } from '../../store/useStore'
import { AnalysisPanel } from './AnalysisPanel'

type Tab = 'curve' | 'analyze' | 'report' | 'retry'

const TABS: [Tab, string][] = [
  ['curve', '局势图'],
  ['analyze', '分析'],
  ['report', '报告'],
  ['retry', '重试'],
]

const RetryPanel: React.FC = () => {
  const game = useStore(s => s.game)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const startPuzzle = useStore(s => s.startPuzzle)
  const ply = game.plies[currentPlyIndex]
  const canRetry = !!ply?.analysis?.bestMove

  return (
    <div className="replay-retry-panel">
      <div className="info-label">重试当前局面</div>
      <div className="panel-hint">
        {canRetry
          ? `第 ${currentPlyIndex + 1} 手 · 重新走出引擎推荐着法`
          : '当前局面还没有分析结果，请先完成整盘分析或切换到有分析的局面'}
      </div>
      <button className="btn btn-primary" disabled={!canRetry}
        onClick={() => startPuzzle(currentPlyIndex)}>
        开始重试
      </button>
    </div>
  )
}

export const ReplayTabs: React.FC = () => {
  const [tab, setTab] = useState<Tab>('curve')

  return (
    <div className="replay-tabs">
      <div className="replay-tabs-bar">
        {TABS.map(([t, label]) => (
          <button key={t} className={`replay-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      <div className="replay-tabs-body">
        {tab === 'curve' && <EvalCurve />}
        {tab === 'analyze' && <AnalysisPanel />}
        {tab === 'report' && <ReportPanel />}
        {tab === 'retry' && <RetryPanel />}
      </div>
    </div>
  )
}
