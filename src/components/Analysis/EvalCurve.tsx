/**
 * 优势曲线 - 计划第13节
 *
 * 横轴: 回合（Ply）
 * 纵轴: 局面评价（红方视角，厘兵）
 * 点击曲线: 棋盘跳到对应回合
 */

import React, { useMemo } from 'react'
import { useStore } from '../../store/useStore'

const W = 320
const H = 96
const PAD = 6
const MAX_CP = 600 // 显示范围 ±6 兵

function y(v: number): number {
  const clamped = Math.max(-MAX_CP, Math.min(MAX_CP, v))
  return H / 2 - (clamped / MAX_CP) * (H / 2 - PAD)
}

export const EvalCurve: React.FC = () => {
  const game = useStore(s => s.game)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const goToPly = useStore(s => s.goToPly)

  // 每个 Ply 的红方视角评估
  const points = useMemo(() => {
    return game.plies.map((ply, i) => {
      if (!ply.analysis) return null
      const raw = ply.turn === 'w' ? ply.analysis.score : -ply.analysis.score
      return { x: i + 1, v: raw }
    })
  }, [game.plies])

  const analyzedCount = points.filter(p => p !== null).length

  if (game.plies.length === 0 || analyzedCount === 0) {
    return (
      <div className="eval-curve-empty">
        整盘分析后显示优势曲线
      </div>
    )
  }

  const n = game.plies.length
  const xOf = (i: number) => PAD + (i / Math.max(1, n)) * (W - PAD * 2)

  // 折线路径（跳过未分析的点）
  const segments: string[] = []
  let current: string[] = []
  points.forEach((p, i) => {
    if (p) {
      current.push(`${xOf(i + 1).toFixed(1)},${y(p.v).toFixed(1)}`)
    } else if (current.length > 0) {
      segments.push(current.join(' '))
      current = []
    }
  })
  if (current.length > 0) segments.push(current.join(' '))

  // 面积填充（首段）
  const firstIdx = points.findIndex(p => p !== null)
  let areaPath = ''
  if (firstIdx >= 0) {
    const lastIdx = (() => {
      for (let i = points.length - 1; i >= 0; i--) if (points[i]) return i
      return -1
    })()
    const pts: string[] = []
    for (let i = firstIdx; i <= lastIdx; i++) {
      const p = points[i]
      if (p) pts.push(`${xOf(i + 1).toFixed(1)},${y(p.v).toFixed(1)}`)
    }
    if (pts.length >= 2) {
      areaPath =
        `M ${xOf(firstIdx + 1).toFixed(1)},${(H / 2).toFixed(1)} ` +
        pts.map(pt => `L ${pt}`).join(' ') +
        ` L ${xOf(lastIdx + 1).toFixed(1)},${(H / 2).toFixed(1)} Z`
    }
  }

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const ply = Math.max(1, Math.min(n, Math.round(ratio * n)))
    goToPly(ply)
  }

  // 当前查看位置标记
  const marker =
    currentPlyIndex >= 1 && points[currentPlyIndex - 1]
      ? { x: xOf(currentPlyIndex), v: points[currentPlyIndex - 1]!.v }
      : null

  return (
    <div className="eval-curve">
      <div className="info-label" style={{ marginBottom: 4 }}>
        优势曲线{analyzedCount < n ? `（分析中 ${analyzedCount}/${n}）` : ''}
      </div>
      <svg
        className="eval-curve-svg"
        viewBox={`0 0 ${W} ${H}`}
        onClick={handleClick}
        preserveAspectRatio="none"
      >
        {/* 半场底色 */}
        <rect x={0} y={PAD} width={W} height={H / 2 - PAD} fill="rgba(230,80,80,0.06)" />
        <rect x={0} y={H / 2} width={W} height={H / 2 - PAD} fill="rgba(80,80,90,0.10)" />
        {/* 零轴 */}
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#555" strokeWidth={1} strokeDasharray="4 3" />
        {/* 面积 */}
        {areaPath && <path d={areaPath} fill="rgba(230,85,85,0.18)" />}
        {/* 折线 */}
        {segments.map((seg, i) => (
          <polyline key={i} points={seg} fill="none" stroke="#e05555" strokeWidth={1.8} strokeLinejoin="round" />
        ))}
        {/* 当前位置标记 */}
        {marker && (
          <circle cx={marker.x} cy={y(marker.v)} r={3.5} fill="#fff" stroke="#e05555" strokeWidth={2} />
        )}
      </svg>
      <div className="eval-curve-axis">
        <span>黑优</span>
        <span>{Math.ceil(n / 2)} 回合</span>
        <span>红优</span>
      </div>
    </div>
  )
}
