/**
 * 局势图（仿天天象棋复盘）
 *
 * - 0 轴中线，红/黑分段着色（红方优势红、黑方优势黑）
 * - Y 轴刻度 ±900/±333/0（厘兵）
 * - 阶段分界竖线「N(中局)」「N(残局)」（子力启发式）
 * - 当前手指示点 + 顶部气泡「N-黑优49分」
 * - 点按/拖动曲线联动棋盘跳转
 * - 红优/黑优 角标
 */
import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { phaseBounds } from '../../game/analysis'

const W = 360
const H = 150
const PAD_L = 36
const PAD_R = 8
const PAD_T = 22
const PAD_B = 10
const MAX_CP = 900

function y(v: number): number {
  const clamped = Math.max(-MAX_CP, Math.min(MAX_CP, v))
  return H / 2 - (clamped / MAX_CP) * (H / 2 - PAD_T)
}

function xOf(i: number, n: number): number {
  return PAD_L + (i / Math.max(1, n)) * (W - PAD_L - PAD_R)
}

export const EvalCurve: React.FC = () => {
  const game = useStore(s => s.game)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const goToPly = useStore(s => s.goToPly)
  const analysisProgress = useStore(s => s.analysisProgress)
  const analyzeCurrentGame = useStore(s => s.analyzeCurrentGame)
  const cancelAnalysis = useStore(s => s.cancelAnalysis)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const [depth, setDepth] = useState<number>(12)

  // 每个 Ply 的红方视角评估（analysis 为该手之前局面的评估）
  const points = useMemo(() => (
    game.plies.map((ply) => {
      if (!ply.analysis) return null
      return ply.turn === 'w' ? ply.analysis.score : -ply.analysis.score
    })
  ), [game.plies]) as (number | null)[]

  const n = game.plies.length
  const analyzedCount = points.filter(p => p !== null).length
  // 整盘分析是否已完成（每手都有实测评估）
  const complete = n > 0 && analyzedCount === n

  // ── 手动整盘分析控制行：深度选择 + 开始/补全按钮；进行中显示进度 + 取消 ──
  const controlRow = (
    <div className="curve-analyze-row">
      {analysisProgress ? (
        <>
          <span className="curve-progress">整盘分析中 {analysisProgress.current}/{analysisProgress.total}…</span>
          <button className="btn btn-sm" onClick={cancelAnalysis}>取消</button>
        </>
      ) : (
        <>
          <select className="settings-select curve-depth" value={depth}
            onChange={e => setDepth(parseInt(e.target.value))}>
            <option value={8}>快速（深度 8）</option>
            <option value={12}>标准（深度 12）</option>
            <option value={16}>深入（深度 16）</option>
          </select>
          <button className="btn btn-sm btn-primary" onClick={() => analyzeCurrentGame(depth)}>
            {analyzedCount > 0 ? '补全整盘分析' : '开始整盘分析'}
          </button>
        </>
      )}
    </div>
  )

  const phases = useMemo(() => phaseBounds(game), [game])

  // 稀疏分析补全：大师库预热只分析关键手（吃子/将军前后），
  // 其余手无数据。线性插值补成连续曲线，插值段单独标记（虚线淡化）。
  const { series, known } = useMemo(() => {
    const vals: (number | null)[] = points.slice()
    const knownArr = vals.map(v => v !== null)
    let prev: number | null = null
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] !== null) {
        if (prev === null) {
          for (let j = 0; j < i; j++) vals[j] = vals[i]
        } else {
          const a = vals[prev] as number
          const b = vals[i] as number
          for (let j = prev + 1; j < i; j++) {
            vals[j] = a + (b - a) * ((j - prev) / (i - prev))
          }
        }
        prev = i
      }
    }
    if (prev !== null) {
      for (let j = prev + 1; j < vals.length; j++) vals[j] = vals[prev]
    }
    return { series: vals as number[], known: knownArr }
  }, [points])

  // 连续折线：相邻两手都有实测 → 实线；任一手为插值 → 虚线淡化
  const paths = useMemo(() => {
    const solid: string[] = []
    const interp: string[] = []
    for (let i = 0; i < n - 1; i++) {
      const d = `M${xOf(i + 1, n).toFixed(1)},${y(series[i]).toFixed(1)} L${xOf(i + 2, n).toFixed(1)},${y(series[i + 1]).toFixed(1)}`
      ;(known[i] && known[i + 1] ? solid : interp).push(d)
    }
    return { solid: solid.join(' '), interp: interp.join(' ') }
  }, [series, known, n])

  if (n === 0 || analyzedCount === 0) {
    return <div className="eval-curve-empty">{controlRow}</div>
  }

  // 当前手：指示点与气泡（该手之前局面的评估；无实测时用插值补全值）
  const curIdx = Math.min(currentPlyIndex, n)
  const curVal = curIdx > 0 ? series[curIdx - 1] : null
  const bubbleText = curVal !== null
    ? `${curIdx}-${curVal >= 0 ? '红优' : '黑优'}${Math.abs(Math.round(curVal))}分`
    : `${curIdx}`

  const plyFromEvent = (e: React.PointerEvent) => {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(ctm.inverse())
    const idx = Math.round(((p.x - PAD_L) / (W - PAD_L - PAD_R)) * n)
    return Math.max(0, Math.min(n, idx))
  }

  // 阶段分界竖线
  const phaseLines: React.ReactNode[] = []
  if (phases.mid > 0) {
    phaseLines.push(
      <g key="mid">
        <line x1={xOf(phases.mid, n)} y1={PAD_T - 8} x2={xOf(phases.mid, n)} y2={H - PAD_B} stroke="#e67e22" strokeWidth="1.5" opacity="0.85" />
        <text x={xOf(phases.mid, n) + 4} y={PAD_T + 4} fontSize="11" fill="#e67e22">{phases.mid}(中局)</text>
      </g>
    )
  }
  if (phases.end > 0) {
    phaseLines.push(
      <g key="end">
        <line x1={xOf(phases.end, n)} y1={PAD_T - 8} x2={xOf(phases.end, n)} y2={H - PAD_B} stroke="#2980b9" strokeWidth="1.5" opacity="0.85" />
        <text x={xOf(phases.end, n) + 4} y={PAD_T + 20} fontSize="11" fill="#2980b9">{phases.end}(残局)</text>
      </g>
    )
  }

  // 气泡位置（防溢出）
  const bubbleX = Math.max(PAD_L + 40, Math.min(W - PAD_R - 40, xOf(curIdx, n)))

  return (
    <div className="eval-curve">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="eval-curve-svg"
        onPointerDown={(e) => { setDragging(true); const idx = plyFromEvent(e); if (idx !== null) goToPly(idx) }}
        onPointerMove={(e) => { if (dragging) { const idx = plyFromEvent(e); if (idx !== null) goToPly(idx) } }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
        style={{ touchAction: 'none' }}>
        {/* 网格与刻度 */}
        {[900, 333, 0, -333, -900].map(v => (
          <g key={v}>
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)}
              stroke={v === 0 ? '#8a8a8a' : '#d8d2c4'} strokeWidth={v === 0 ? 1 : 0.6}
              strokeDasharray={v === 0 ? 'none' : '3 3'} />
            <text x={PAD_L - 4} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#8a8a8a">{v > 0 ? v : v}</text>
          </g>
        ))}
        {phaseLines}
        {/* 曲线：0 轴上下分别裁剪为红/黑；实测段实线，插值段虚线淡化 */}
        <defs>
          <clipPath id="ec-red"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="ec-black"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        {paths.interp && <>
          <path d={paths.interp} fill="none" stroke="#c0392b" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.45" clipPath="url(#ec-red)" />
          <path d={paths.interp} fill="none" stroke="#2c2c2c" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.45" clipPath="url(#ec-black)" />
        </>}
        {paths.solid && <>
          <path d={paths.solid} fill="none" stroke="#c0392b" strokeWidth="2" clipPath="url(#ec-red)" />
          <path d={paths.solid} fill="none" stroke="#2c2c2c" strokeWidth="2" clipPath="url(#ec-black)" />
        </>}
        {/* 当前手指示点 */}
        {curVal !== null && (
          <g>
            <circle cx={xOf(curIdx, n)} cy={y(curVal)} r="5" fill="#fff" stroke="#27ae60" strokeWidth="2.5" />
          </g>
        )}
        {/* 气泡 */}
        <g>
          <rect x={bubbleX - 52} y="2" width="104" height="18" rx="3" fill="#2c2c2c" opacity="0.92" />
          <text x={bubbleX} y="15" textAnchor="middle" fontSize="11" fill="#fff">{bubbleText}</text>
        </g>
        {/* 红优/黑优角标 */}
        <g>
          <rect x={PAD_L + 2} y={PAD_T + 2} width="34" height="15" rx="2" fill="#c0392b" opacity="0.9" />
          <text x={PAD_L + 19} y={PAD_T + 13} textAnchor="middle" fontSize="10" fill="#fff">红优</text>
          <rect x={PAD_L + 2} y={H - PAD_B - 17} width="34" height="15" rx="2" fill="#2c2c2c" opacity="0.9" />
          <text x={PAD_L + 19} y={H - PAD_B - 6} textAnchor="middle" fontSize="10" fill="#fff">黑优</text>
        </g>
      </svg>
      {!complete && controlRow}
    </div>
  )
}
