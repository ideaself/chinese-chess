/**
 * 复盘分析 Tab 区（仿天天象棋分析页）：局势图 | 分析 | 报告
 * 移动端复盘模式下常驻于棋盘下方。
 */
import React, { useState } from 'react'
import { EvalCurve } from './EvalCurve'
import { KeyMoments } from './KeyMoments'
import { ReportPanel } from './ReportPanel'

type Tab = 'curve' | 'analyze' | 'report'

const TABS: [Tab, string][] = [
  ['curve', '局势图'],
  ['analyze', '分析'],
  ['report', '报告'],
]

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
        {tab === 'analyze' && <KeyMoments />}
        {tab === 'report' && <ReportPanel />}
      </div>
    </div>
  )
}
