/**
 * 自我分析引擎横幅（仿天天象棋自我分析页顶部）
 *
 * 「黑优68 | 运算中… | 深度23 | 广度1.98M | 速度414138」+ 推荐着法行
 * 进入推演走子后自动对当前局面实时分析（onInfo 流式更新），并在棋盘画推荐箭头。
 */
import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { boardToFen } from '../../game/board'
import { chineseFromFen } from '../../game/rules'
import type { EngineInfo } from '../../engine/pikafish'

export const SelfAnalysisBanner: React.FC = () => {
  const variation = useStore(s => s.variation)
  const board = useStore(s => s.board)
  const engine = useStore(s => s.engine)
  const engineReady = useStore(s => s.engineReady)
  const [precise, setPrecise] = useState(false)
  const [hideHints, setHideHints] = useState(false)
  const [running, setRunning] = useState(false)
  const runIdRef = useRef(0)

  // 就地读取最新引擎流结果（横幅是唯一写方，避免新增 store action）
  const evalBar = useStore(s => s.evalBar)
  const analysis = useStore(s => s.analysis)

  const fen = boardToFen(board)

  // 局面变化 → 实时分析（普通=12 深度，精准=18）
  useEffect(() => {
    if (!variation || !engine || !engineReady) return
    const runId = ++runIdRef.current
    let last: EngineInfo | null = null
    setRunning(true)
    engine.analyze(fen, [], precise ? 18 : 12, (info) => {
      if (runId !== runIdRef.current) return
      last = info
      useStore.setState({
        evalBar: { score: info.score, fen, depth: info.depth, nodes: info.nodes, nps: info.nps },
        analysis: { depth: info.depth, score: info.score, bestMove: info.move, pv: info.pv, fen },
      })
    }).then(() => {
      if (runId !== runIdRef.current) return
      setRunning(false)
      const l = last
      if (l) {
        useStore.setState({
          analysis: { depth: l.depth, score: l.score, bestMove: l.move, pv: l.pv, fen },
        })
      }
    }).catch(() => { if (runId === runIdRef.current) setRunning(false) })
    return () => { runIdRef.current++ }
  }, [variation, fen, engine, engineReady, precise])

  // 推荐箭头（棋盘带序号 1 的着法箭头）；隐藏提示或退出推演时清除残留
  useEffect(() => {
    if (!variation || hideHints) {
      if (useStore.getState().hintInfo) useStore.setState({ hintInfo: null })
      return
    }
    const a = analysis
    if (!a || a.fen !== fen || !a.bestMove || a.bestMove.length < 4) return
    const moveCn = chineseFromFen(fen, a.bestMove)
    if (useStore.getState().hintInfo?.movesUci?.[0] === a.bestMove) return
    useStore.setState({
      hintInfo: { moveCn, score: a.score, line: [moveCn], movesUci: [a.bestMove] },
    })
  }, [variation, hideHints, analysis, fen])

  // 卸载时清除箭头残留
  useEffect(() => () => {
    if (useStore.getState().hintInfo) useStore.setState({ hintInfo: null })
  }, [])

  if (!variation) return null

  const score = evalBar?.fen === fen ? evalBar.score : (analysis?.fen === fen ? analysis.score : null)
  const best = analysis?.fen === fen ? analysis.bestMove : ''
  const bestCn = best ? chineseFromFen(fen, best) : ''
  const fmt = (n?: number) => {
    if (n === undefined || n === null) return '—'
    return n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
  }
  const cur = evalBar?.fen === fen ? evalBar : null

  return (
    <div className="self-banner">
      <div className="self-banner-main">
        <span className="self-score">{score !== null ? `${score >= 0 ? '红优' : '黑优'} ${Math.abs(score)}` : '均势'}</span>
        <span className="self-running">{running ? '运算中…' : ''}</span>
        <span className="self-meta">深度{cur?.depth ?? '—'} | 广度{fmt(cur?.nodes)} | 速度{fmt(cur?.nps)}</span>
      </div>
      <div className="self-banner-sub">
        <span className="self-best">{bestCn ? `推荐 ${bestCn}` : ''}</span>
        <span className="self-controls">
          <button className={`self-chip ${!precise ? 'on' : ''}`} onClick={() => setPrecise(false)}>普通</button>
          <button className={`self-chip ${precise ? 'on' : ''}`} onClick={() => setPrecise(true)}>精准</button>
          <button className={`self-chip ${hideHints ? 'on' : ''}`} onClick={() => setHideHints(!hideHints)}>
            {hideHints ? '显示提示' : '隐藏提示'}
          </button>
        </span>
      </div>
    </div>
  )
}
