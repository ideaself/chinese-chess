/**
 * 关键时刻 - 计划第12/14节
 *
 * 分析完成后提取关键失误/转折点，点击跳转对应局面。
 * 计划第14节: 全部 / 只看我的错误 / 只看AI错误 / 只看优势转换。
 */

import React, { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import type { MoveClassification } from '../../game/model'

const ERROR_LEVELS: MoveClassification[] = ['mistake', 'blunder', 'blunder2']

const LABELS: Record<string, string> = {
  mistake: '疑问',
  blunder: '失误',
  blunder2: '严重失误',
}

const ICONS: Record<string, string> = {
  mistake: '⚠️',
  blunder: '❌',
  blunder2: '❌❌',
  swing: '⚡',
}

type SideFilter = 'all' | 'me' | 'ai' | 'swing'

type Moment = {
  index: number
  kind: 'error'
  classification: MoveClassification
} | {
  index: number
  kind: 'swing'
  /** 获得主动一方 */
  leader: 'red' | 'black'
}

export const KeyMoments: React.FC = () => {
  const game = useStore(s => s.game)
  const playerSide = useStore(s => s.playerSide)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const goToPly = useStore(s => s.goToPly)
  const startPuzzle = useStore(s => s.startPuzzle)
  const [filter, setFilter] = useState<SideFilter>('all')

  const hasAnalysis = game.plies.some(p => p.analysis)

  const moments = useMemo((): Moment[] => {
    if (!hasAnalysis) return []

    // 失误时刻
    const errors: Moment[] = game.plies
      .map((ply, index): Moment | null => {
        if (!ply.analysis || !ERROR_LEVELS.includes(ply.analysis.classification)) return null
        return { index, kind: 'error', classification: ply.analysis.classification }
      })
      .filter((m): m is Moment => m !== null)

    // 优势转换: 红方视角评估符号翻转且幅度显著（≥1.5兵）
    const swings: Moment[] = []
    for (let i = 0; i < game.plies.length - 1; i++) {
      const a = game.plies[i].analysis
      const b = game.plies[i + 1].analysis
      if (!a || !b) continue
      const eBefore = game.plies[i].turn === 'w' ? a.score : -a.score
      const eAfter = game.plies[i + 1].turn === 'w' ? b.score : -b.score
      if (eBefore * eAfter < 0 && Math.min(Math.abs(eBefore), Math.abs(eAfter)) >= 150) {
        swings.push({ index: i, kind: 'swing', leader: eAfter > 0 ? 'red' : 'black' })
      }
    }

    switch (filter) {
      case 'all':
        return [...errors, ...swings].sort((x, y) => x.index - y.index).slice(0, 10)
      case 'me':
        return errors.filter(m => game.plies[m.index].turn === playerSide)
          .sort((x, y) =>
            (game.plies[y.index].analysis!.moveLoss) - (game.plies[x.index].analysis!.moveLoss))
          .slice(0, 8)
          .sort((x, y) => x.index - y.index)
      case 'ai':
        return errors.filter(m => game.plies[m.index].turn !== playerSide)
          .sort((x, y) =>
            (game.plies[y.index].analysis!.moveLoss) - (game.plies[x.index].analysis!.moveLoss))
          .slice(0, 8)
          .sort((x, y) => x.index - y.index)
      case 'swing':
        return swings.sort((x, y) => y.index - x.index).slice(0, 8).sort((x, y) => x.index - y.index)
    }
  }, [game.plies, filter, playerSide, hasAnalysis])

  if (!hasAnalysis || game.plies.length === 0) return null

  return (
    <div className="key-moments">
      <div className="key-moments-header">
        <span className="info-label">关键时刻</span>
        <div className="key-moments-filter">
          {([['all', '全部'], ['me', '我的错误'], ['ai', 'AI错误'], ['swing', '优势转换']] as [SideFilter, string][]).map(([k, label]) => (
            <button
              key={k}
              className={`filter-btn ${filter === k ? 'btn-active' : ''}`}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {moments.length === 0 ? (
        <div className="panel-hint">
          {filter === 'all' ? '没有找到明显失误，发挥稳定！' : '该类别下没有关键时刻'}
        </div>
      ) : (
        <div className="key-moments-list">
          {moments.map(m => {
            const ply = game.plies[m.index]
            if (m.kind === 'swing') {
              return (
                <div
                  key={`s${m.index}`}
                  className={`key-moment-row ${currentPlyIndex === m.index ? 'btn-active' : ''}`}
                  onClick={() => goToPly(m.index)}
                >
                  <span className="key-moment-icon">{ICONS.swing}</span>
                  <span className="key-moment-round">第{Math.floor(m.index / 2) + 1}回合</span>
                  <span className="key-moment-label" style={{ color: '#f39c12' }}>优势转换</span>
                  <span className="key-moment-detail">{m.leader === 'red' ? '红方' : '黑方'}取得主动</span>
                </div>
              )
            }
            return (
              <div
                key={m.index}
                className={`key-moment-row ${currentPlyIndex === m.index ? 'btn-active' : ''}`}
                onClick={() => goToPly(m.index)}
              >
                <span className="key-moment-icon">{ICONS[m.classification]}</span>
                <span className="key-moment-round">第{Math.floor(m.index / 2) + 1}回合</span>
                <span className="key-moment-label">{LABELS[m.classification]}</span>
                <span className="key-moment-detail">
                  {ply.moveCn}
                  {ply.analysis!.bestMoveCn && ply.analysis!.bestMoveCn !== ply.moveCn
                    ? ` → 应走 ${ply.analysis!.bestMoveCn}`
                    : ''}
                </span>
                {/* 错误重走入口 - 计划第17节（仅自己的失误） */}
                {ply.turn === playerSide && ply.analysis!.bestMove && (
                  <button
                    className="btn btn-sm key-moment-retry"
                    onClick={(e) => { e.stopPropagation(); startPuzzle(m.index) }}
                  >
                    重走
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
