/**
 * 复盘报告（仿天天象棋「报告」Tab）
 *
 * - 双方精准度（由着法平均损失映射）
 * - 开/中/残阶段划分
 * - 错着/漏着汇总清单（点击跳转对应手）
 */
import React, { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { phaseRanges, accuracyFromAvgLoss } from '../../game/analysis'
import type { MoveClassification } from '../../game/model'

const BAD_LEVELS: MoveClassification[] = ['mistake', 'blunder', 'blunder2']
const LEVEL_LABEL: Record<string, string> = {
  inaccuracy: '缓着',
  mistake: '失误',
  blunder: '漏着',
  blunder2: '败着',
}

export const ReportPanel: React.FC = () => {
  const game = useStore(s => s.game)
  const goToPly = useStore(s => s.goToPly)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const analysisProgress = useStore(s => s.analysisProgress)
  const analyzeAction = useStore(s => s.analyzeCurrentGame)

  const data = useMemo(() => {
    const losses: Record<'w' | 'b', number[]> = { w: [], b: [] }
    const bad: { idx: number; turn: 'w' | 'b'; cn: string; level: MoveClassification; loss: number }[] = []
    game.plies.forEach((p, i) => {
      if (!p.analysis) return
      losses[p.turn].push(p.analysis.moveLoss ?? 0)
      const lv = p.analysis.classification
      if (lv && BAD_LEVELS.includes(lv)) {
        bad.push({ idx: i + 1, turn: p.turn, cn: p.moveCn, level: lv, loss: p.analysis.moveLoss ?? 0 })
      }
    })
    const acc = (side: 'w' | 'b') => {
      const arr = losses[side]
      if (arr.length === 0) return null
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length
      return accuracyFromAvgLoss(avg)
    }
    return { redAcc: acc('w'), blackAcc: acc('b'), bad, analyzed: losses.w.length + losses.b.length }
  }, [game])

  if (data.analyzed === 0) {
    return (
      <div className="eval-curve-empty">
        {analysisProgress
          ? `整盘分析中 ${analysisProgress.current}/${analysisProgress.total}…`
          : <button className="btn btn-sm btn-primary" onClick={() => analyzeAction()}>生成对局报告</button>}
      </div>
    )
  }

  const ranges = phaseRanges(game)

  return (
    <div className="report-panel">
      <div className="report-accuracy">
        <div className="report-acc-item red">
          <span className="report-acc-label">红方精准度</span>
          <span className="report-acc-value">{data.redAcc ?? '—'}<i>%</i></span>
        </div>
        <div className="report-acc-item black">
          <span className="report-acc-label">黑方精准度</span>
          <span className="report-acc-value">{data.blackAcc ?? '—'}<i>%</i></span>
        </div>
      </div>
      <div className="report-phases">
        {ranges.map(r => (
          <span key={r.label} className="report-phase-chip">{r.label} {r.from + 1}-{r.to}手</span>
        ))}
      </div>
      <div className="report-bad-title">错着汇总（{data.bad.length}）</div>
      {data.bad.length === 0 && <div className="report-bad-empty">双方没有明显错着，好棋！</div>}
      <div className="report-bad-list">
        {data.bad.map(b => (
          <button key={b.idx} className={`report-bad-row ${b.turn === 'w' ? 'red' : 'black'} ${currentPlyIndex === b.idx ? 'active' : ''}`}
            onClick={() => goToPly(b.idx)}>
            <span className="rb-idx">第{b.idx}手</span>
            <span className="rb-cn">{b.cn}</span>
            <span className={`rb-level lv-${b.level}`}>{LEVEL_LABEL[b.level] ?? '失误'}</span>
            <span className="rb-loss">-{(b.loss / 100).toFixed(1)}兵</span>
          </button>
        ))}
      </div>
    </div>
  )
}
