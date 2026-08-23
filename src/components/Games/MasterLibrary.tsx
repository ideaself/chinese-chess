/**
 * 大师棋谱库 - 天天象棋式分类浏览
 *
 * 数据来自 public/master-games.json（dpxq 语料转换产物），
 * 不占用 localStorage；点击棋局直接进入复盘研习。
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import {
  loadLibrary, getCachedLibrary, loadMoreGames, hasMoreGames, getLibraryInfo,
  recordToGame, recordTitle,
  FAMILY_INFO, DEFENSE_INFO,
  aggregateOpeningStats, formatStats,
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
  const [info, setInfo] = useState<{ total: number; loaded: number; source: string } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let alive = true
    loadLibrary()
      .then(() => { if (alive) { setGames(getCachedLibrary() ?? []); setInfo(getLibraryInfo()) } })
      .catch(e => { if (alive) setError(`棋谱库加载失败: ${e.message}`) })
    return () => { alive = false }
  }, [])

  /** 加载下一分片 */
  const handleLoadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      await loadMoreGames()
      setGames(getCachedLibrary() ?? [])
      setInfo(getLibraryInfo())
    } catch (e) {
      showToast(`分片加载失败: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoadingMore(false)
    }
  }

  // 开局体系计数（用于子筛选徽标）
  const familyCounts = useMemo(() => {
    if (!games) return null
    const counts = new Map<OpeningFamily, number>()
    for (const g of games) counts.set(g.cls.family, (counts.get(g.cls.family) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [games])

  // 开局胜率统计（开局页签展示）
  const stats = useMemo(
    () => (games && category === 'opening' ? aggregateOpeningStats(games) : null),
    [games, category],
  )

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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>
            {info ? `已加载 ${info.loaded}/${info.total} 局` : `共 ${games.length} 局`}
          </span>
          <button className="btn btn-sm btn-active" title="随机选一局，猜大师的每一步"
            onClick={() => useStore.getState().startMasterQuiz()}>
            🎯 名局拆解
          </button>
        </div>
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

      {/* 开局胜率统计 */}
      {stats && familyCounts && (
        <div className="lib-stats">
          <div className="info-label" style={{ marginBottom: 6 }}>胜率统计（点击行筛选对局）</div>
          {familyCounts.map(([f, n]) => {
            const s = stats.get(f)
            if (!s) return null
            const defenses = f === 'zhongpao'
              ? [...stats.entries()].filter(([k]) => k.startsWith('zhongpao|'))
              : []
            return (
              <React.Fragment key={f}>
                <button className={`lib-stats-row ${family === f ? 'lib-stats-active' : ''}`}
                  onClick={() => { setCategory('opening'); setFamily(family === f ? 'all' : f); setVisible(PAGE_SIZE) }}>
                  <span className="lib-stats-name">{FAMILY_INFO[f].name}</span>
                  <span className="lib-stats-meta">{n}局 · {formatStats(s)}</span>
                  <span className="lib-stats-bar">
                    <i style={{ width: `${(s.redWin / s.total) * 100}%`, background: 'var(--red)' }} />
                    <i style={{ width: `${(s.draw / s.total) * 100}%`, background: '#f39c12' }} />
                    <i style={{ width: `${(s.blackWin / s.total) * 100}%`, background: '#5b8dd6' }} />
                  </span>
                </button>
                {family === 'zhongpao' && defenses.map(([key, ds]) => {
                  const def = key.split('|')[1] as keyof typeof DEFENSE_INFO
                  return (
                    <div key={key} style={{ paddingLeft: 18 }}>
                      <div className="lib-stats-row lib-stats-sub">
                        <span className="lib-stats-name">{DEFENSE_INFO[def]?.name || key}</span>
                        <span className="lib-stats-meta">{ds.total}局 · {formatStats(ds)}</span>
                        <span className="lib-stats-bar">
                          <i style={{ width: `${(ds.redWin / ds.total) * 100}%`, background: 'var(--red)' }} />
                          <i style={{ width: `${(ds.draw / ds.total) * 100}%`, background: '#f39c12' }} />
                          <i style={{ width: `${(ds.blackWin / ds.total) * 100}%`, background: '#5b8dd6' }} />
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#777', padding: '0 8px 4px' }}>{DEFENSE_INFO[def]?.desc}</div>
                    </div>
                  )
                })}
              </React.Fragment>
            )
          })}
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
      {filtered.length <= visible && hasMoreGames() && (
        <button className="btn btn-sm" style={{ marginTop: 8, alignSelf: 'center' }}
          disabled={loadingMore}
          onClick={handleLoadMore}>
          {loadingMore ? '加载中…' : '加载更多棋谱（下一分片）'}
        </button>
      )}
    </div>
  )
}
