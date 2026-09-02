/**
 * 大师参考面板 - 相似局面检索
 *
 * 复盘/分析时展示当前局面下大师们的实战着法（141k 局棋谱），
 * 点击着法可查看走出该着的对局并跳转复盘。
 */

import React, { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import {
  loadSimilarShard, loadMetaFor, querySimilar, moveScore, gameMeta,
  canOpenGame, type SimilarEntry,
} from '../../game/similar'
import { chineseFromFen } from '../../game/rules'
import { loadLibrary, getCachedLibrary, recordToGame } from '../../game/masterLibrary'

interface Props {
  /** 当前局面 FEN */
  fen: string
  /** 已走着法（UCI 序列） */
  moves: string[]
}

export const SimilarPanel: React.FC<Props> = ({ fen, moves }) => {
  const loadGameObject = useStore(s => s.loadGameObject)
  const setSheetTab = useStore(s => s.setSheetTab)
  const setTab = useStore(s => s.setTab)
  const showToast = useStore(s => s.showToast)

  const [entries, setEntries] = useState<SimilarEntry[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [openIds, setOpenIds] = useState<number[]>([])

  // 查询：moves 变化时加载对应索引分片
  useEffect(() => {
    setEntries(null)
    setExpanded(null)
    setOpenIds([])
    if (!moves || moves.length === 0) return
    let alive = true
    loadSimilarShard(moves[0]).then(() => {
      if (!alive) return
      const q = querySimilar(moves)
      setEntries(q)
      if (q) {
        const ids = q.flatMap(e => e.gameIds).slice(0, 200)
        setOpenIds(ids)
        loadMetaFor(ids)
      }
    })
    return () => { alive = false }
  }, [moves.join(' ')])

  const openGame = async (gameId: number) => {
    let lib = getCachedLibrary()
    if (!lib) {
      await loadLibrary().catch(() => undefined)
      lib = getCachedLibrary()
    }
    const rec = lib?.find(g => g.id === gameId)
    if (!rec) {
      showToast('该对局未收录，仅可查看信息')
      return
    }
    const game = recordToGame(rec)
    if (!game) { showToast('⚠ 棋谱数据有误'); return }
    loadGameObject(game)
    setTab('play')
    setSheetTab('puzzle') // 复用复盘页入口（BOARD_HOME）
  }

  if (!moves || moves.length === 0) return null

  return (
    <div className="similar-panel" style={{ marginTop: 12 }}>
      <div className="ctrl-title" style={{ marginBottom: 6 }}>🏛 大师参考（{moves.length} 步）</div>
      {entries === null ? (
        <div className="panel-hint">加载大师对局索引…</div>
      ) : entries.length === 0 ? (
        <div className="panel-hint">
          {moves.length > 6
            ? '已超出收录深度（前 6 步），大师参考不可用'
            : '该局面未收录大师对局'}
        </div>
      ) : (
        <div className="similar-list">
          {entries.slice(0, 8).map(e => {
            const { n, redScore } = moveScore(e)
            const cn = e.move.length >= 4 ? chineseFromFen(fen, e.move) : e.move
            return (
              <div key={e.move} className="similar-item">
                <div className="similar-row"
                  onClick={() => setExpanded(expanded === e.move ? null : e.move)}>
                  <span className="similar-move">{cn || e.move}</span>
                  <span className="similar-count">{n} 局</span>
                  <span className="similar-score">红方得分率 {Math.round(redScore * 100)}%</span>
                  <span className="similar-toggle">{expanded === e.move ? '▾' : '▸'}</span>
                </div>
                {expanded === e.move && (
                  <div className="similar-games">
                    {e.gameIds.slice(0, 12).map(id => {
                      const m = gameMeta(id)
                      if (!m) return null
                      return (
                        <div key={id} className="similar-game"
                          onClick={() => canOpenGame(id) && openGame(id)}>
                          <span className={canOpenGame(id) ? 'sg-title' : 'sg-title sg-dim'}>
                            {m.t || `${m.r} vs ${m.b}`}
                          </span>
                          <span className="sg-event">{m.e}</span>
                          {canOpenGame(id) && <span className="sg-open">▶ 复盘</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}