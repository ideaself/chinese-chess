/**
 * 大师棋谱库 - 天天象棋式分类浏览
 *
 * 数据来自 public/master-games.json（dpxq 语料转换产物），
 * 不占用 localStorage；点击棋局直接进入复盘研习。
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import {
  loadLibrary, classifyLibrary, recordToGame, recordTitle,
  FAMILY_INFO, DEFENSE_INFO,
} from '../../game/masterLibrary'
import type { LibraryGame } from '../../game/masterLibrary'
import type { OpeningFamily } from '../../game/masterLibrary'

const PAGE_SIZE = 80

type Category = 'all' | 'opening' | 'endgame'

export const MasterLibrary: React.FC = () => {
  const loadGameObject = useStore(s => s.loadGameObject)
  const setTab = useStore(s => s.setTab)
  const showToast = useStore(s => s.showToast)

  const [games, setGames] = useState<LibraryGame[] | null>(null)
  const [error, setError] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [family, setFamily] = useState<OpeningFamily | 'all'>('all')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  useEffect(() => {
    let alive = true
    loadLibrary()
      .then(payload => { if (alive) setGames(classifyLibrary(payload.games)) })
      .catch(e => { if (alive) setError(`棋谱库加载失败: ${e.message}`) })
    return () => { alive = false }
  }, [])

  // 开局体系计数（用于子筛选徽标）
  const familyCounts = useMemo(() => {
    if (!games) return null
    const counts = new Map<OpeningFamily, number>()
    for (const g of games) counts.set(g.cls.family, (counts.get(g.cls.family) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [games])

  const filtered = useMemo(() => {
    if (!games) return []
    let list = games
    if (category === 'opening') {
      list = list.filter(g => g.cls.family !== 'other')
      if (family !== 'all') list = list.filter(g => g.cls.family === family)
    } else if (category === 'endgame') {
      list = list.filter(g => g.cls.endgame)
    }
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(g =>
      recordTitle(g).toLowerCase().includes(q) ||
      (g.e || '').toLowerCase().includes(q) ||
      (g.d || '').includes(q),
    )
  }, [games, category, family, query])

  const openGame = (rec: LibraryGame) => {
    const game = recordToGame(rec)
    if (!game) { showToast('⚠ 该棋谱数据有误，无法打开'); return }
    loadGameObject(game)
    setTab('play')
  }

  if (error) {
    return (
      <div className="master-library">
        <div className="panel-hint" style={{ padding: 24, textAlign: 'center' }}>
          {error}
          <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
            运行 node scripts/dpxq-convert.mjs 可重新生成棋谱库数据
          </div>
        </div>
      </div>
    )
  }

  if (!games) {
    return (
      <div className="master-library">
        <div className="panel-hint" style={{ padding: 24, textAlign: 'center' }}>棋谱库加载中…</div>
      </div>
    )
  }

  return (
    <div className="master-library">
      <div className="panel-header">
        <h3>大师棋谱库</h3>
        <span style={{ fontSize: 12, color: '#888' }}>共 {games.length} 局 · 东萍象棋网</span>
      </div>

      {/* 大类 */}
      <div className="controls-row" style={{ marginBottom: 6 }}>
        {([['all', `全部`], ['opening', '开局'], ['endgame', '实战残局']] as [Category, string][]).map(([c, label]) => (
          <button key={c} className={`btn btn-sm ${category === c ? 'btn-active' : ''}`}
            onClick={() => { setCategory(c); setFamily('all'); setVisible(PAGE_SIZE) }}>
            {label}
          </button>
        ))}
      </div>

      {/* 开局体系子筛选 */}
      {category === 'opening' && familyCounts && (
        <div className="controls-row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${family === 'all' ? 'btn-active' : ''}`}
            onClick={() => { setFamily('all'); setVisible(PAGE_SIZE) }}>全部体系</button>
          {familyCounts.map(([f, n]) => (
            <button key={f} className={`btn btn-sm ${family === f ? 'btn-active' : ''}`}
              title={FAMILY_INFO[f].desc}
              onClick={() => { setFamily(f); setVisible(PAGE_SIZE) }}>
              {FAMILY_INFO[f].name} {n}
            </button>
          ))}
        </div>
      )}

      {/* 分类说明 */}
      {category === 'opening' && family !== 'all' && (
        <div style={{ fontSize: 12, color: '#9a9aa8', margin: '4px 0 8px' }}>
          {FAMILY_INFO[family].desc}
        </div>
      )}
      {category === 'endgame' && (
        <div style={{ fontSize: 12, color: '#9a9aa8', margin: '4px 0 8px' }}>
          收录残局阶段较长的大师实战对局，学习车马炮兵残局技巧与定式
        </div>
      )}

      {/* 搜索 */}
      <input
        className="search-input"
        placeholder="搜索棋手 / 赛事 / 日期…"
        value={query}
        onChange={e => { setQuery(e.target.value); setVisible(PAGE_SIZE) }}
      />

      {/* 列表 */}
      <div className="game-list-items">
        {filtered.length === 0 ? (
          <div className="panel-hint" style={{ padding: 20, textAlign: 'center' }}>无匹配对局</div>
        ) : (
          filtered.slice(0, visible).map(rec => (
            <div key={rec.id} className="game-item" onClick={() => openGame(rec)}>
              <div className="game-item-left">
                <span className={`game-result ${rec.res === '红胜' ? 'result-win' : rec.res === '黑胜' ? 'result-loss' : 'result-draw'}`}>
                  {rec.res || '…'}
                </span>
                <div className="game-item-info">
                  <div className="game-item-players">{recordTitle(rec)}</div>
                  <div className="game-item-meta">
                    {Math.floor(rec.mv.length / 8)}回合
                    {rec.e ? ` · ${rec.e}` : ''}
                    {rec.d && !/^0000/.test(rec.d) ? ` · ${rec.d}` : ''}
                  </div>
                </div>
              </div>
              <span className="lib-badge">{DEFENSE_INFO[rec.cls.defense!]?.name ?? FAMILY_INFO[rec.cls.family].name}</span>
            </div>
          ))
        )}
      </div>

      {filtered.length > visible && (
        <button className="btn btn-sm" style={{ marginTop: 8, alignSelf: 'center' }}
          onClick={() => setVisible(v => v + PAGE_SIZE)}>
          加载更多（剩余 {filtered.length - visible} 局）
        </button>
      )}
    </div>
  )
}
