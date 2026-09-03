/**
 * 大师棋谱库 - 天天象棋式分类浏览
 *
 * 数据来自 public/master-games.json（dpxq 语料转换产物），
 * 不占用 localStorage；点击棋局直接进入复盘研习。
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { BOARD_HOME } from '../../store/constants'
import {
  loadLibrary, getCachedLibrary, getLibraryInfo,
  recordToGame, recordTitle,
  aggregatePlayers, gameHasPlayer, aggregatePlayerProfile,
  FAMILY_INFO, DEFENSE_INFO,
  aggregateOpeningStats, formatStats,
} from '../../game/masterLibrary'
import type { LibraryGame } from '../../game/masterLibrary'
import type { OpeningFamily } from '../../game/masterLibrary'
import {
  startPreanalysis, cancelPreanalysis, isPreanalysisRunning, applyCachedAnalysis,
} from '../../game/masterPreanalysis'
import { loadStaticAnalysis } from '../../game/staticAnalysis'
import type { PreanalysisProgress } from '../../game/masterPreanalysis'
import { registerBackHandler } from '../../game/backNav'
import { getAllMasterAnalysisIds } from '../../game/storage'
import { InsightsPanel } from './InsightsPanel'
import { loadInsights, getInsights } from '../../game/insights'

const PAGE_SIZE = 80

type Category = 'all' | 'opening' | 'endgame'

export const MasterLibrary: React.FC = () => {
  const loadGameObject = useStore(s => s.loadGameObject)
  const setSheetTab = useStore(s => s.setSheetTab)
  const setTab = useStore(s => s.setTab)
  const showToast = useStore(s => s.showToast)

  const [games, setGames] = useState<LibraryGame[] | null>(null)
  const [error, setError] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [family, setFamily] = useState<OpeningFamily | 'all'>('all')
  const [query, setQuery] = useState('')
  const [player, setPlayer] = useState('')
  const [result, setResult] = useState<'all' | '红胜' | '黑胜' | '和'>('all')
  const [playerInput, setPlayerInput] = useState('')
  const [playerOpen, setPlayerOpen] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [info, setInfo] = useState<{ total: number; loaded: number; source: string } | null>(null)
  // 批量预分析状态
  const [preRunning, setPreRunning] = useState(isPreanalysisRunning())
  const [preProgress, setPreProgress] = useState<PreanalysisProgress | null>(null)
  const [cachedCount, setCachedCount] = useState<number | null>(null)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [playerInsight, setPlayerInsight] = useState<{ mistakeRate: number; blunderRate: number } | null>(null)

  // 加载洞察数据（棋手失误率显示用）
  useEffect(() => {
    loadInsights().then(() => {
      const d = getInsights()
      if (d) {
        const p = d.stats.players.find(p => p.name === player)
        setPlayerInsight(p ? { mistakeRate: p.mistakeRate, blunderRate: p.blunderRate } : null)
      }
    })
  }, [player])

  useEffect(() => {
    let alive = true
    loadLibrary()
      .then(() => { if (alive) { setGames(getCachedLibrary() ?? []); setInfo(getLibraryInfo()) } })
      .catch(e => { if (alive) setError(`棋谱库加载失败: ${e.message}`) })
    getAllMasterAnalysisIds().then(ids => { if (alive) setCachedCount(ids.size) })
    return () => { alive = false }
  }, [])

  // 棋手页纳入返回栈：按返回先关棋手页回列表
  useEffect(() => {
    if (!playerOpen) return
    return registerBackHandler(() => { setPlayerOpen(false); return true })
  }, [playerOpen])

  /** 启动/停止批量预分析 */
  const togglePreanalysis = () => {
    if (preRunning) {
      cancelPreanalysis()
      return
    }
    const handle = startPreanalysis({
      deps: {
        getEngine: () => useStore.getState().engine,
        isEngineBusy: () => useStore.getState().isThinking,
      },
      onProgress: setPreProgress,
      onDone: s => {
        setPreRunning(false)
        setPreProgress(null)
        getAllMasterAnalysisIds().then(ids => setCachedCount(ids.size))
        showToast(s.cancelled
          ? `预分析已停止（完成 ${s.analysed} 局）`
          : `预分析完成：${s.analysed} 局入缓存${s.failed ? ` · ${s.failed} 失败` : ''}`)
      },
    })
    if (handle) {
      setPreRunning(true)
      setPreProgress(null)
    }
  }

  // 棋手选项（来自已加载对局，按局数降序）
  const players = useMemo(() => (games ? aggregatePlayers(games) : []), [games])

  // 棋手下拉匹配（输入过滤，空串显示局数最多的前 50 人）
  const playerMatches = useMemo(() => {
    const q = playerInput.trim().toLowerCase()
    const list = q ? players.filter(p => p.name.toLowerCase().includes(q)) : players
    return list.slice(0, 50)
  }, [players, playerInput])

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

  // 棋手页聚合（选中棋手时展示）
  const profile = useMemo(
    () => (player && games ? aggregatePlayerProfile(games, player) : null),
    [player, games],
  )

  const filtered = useMemo(() => {
    if (!games) return []
    let list = games
    if (player) list = list.filter(g => gameHasPlayer(g, player))
    if (category === 'opening') {
      list = list.filter(g => g.cls.family !== 'other')
      if (family !== 'all') list = list.filter(g => g.cls.family === family)
    } else if (category === 'endgame') {
      list = list.filter(g => g.cls.endgame)
    }
    if (result !== 'all') {
      list = result === '和'
        ? list.filter(g => g.res && g.res !== '红胜' && g.res !== '黑胜')
        : list.filter(g => g.res === result)
    }
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(g =>
      recordTitle(g).toLowerCase().includes(q) ||
      (g.e || '').toLowerCase().includes(q) ||
      (g.d || '').includes(q),
    )
  }, [games, category, family, query, player, result])

  const openGame = async (rec: LibraryGame) => {
    const game = recordToGame(rec)
    if (!game) { showToast('⚠ 该棋谱数据有误，无法打开'); return }
    // 静态关键点分析（离线导出）：命中则直接物化，无需引擎
    try {
      const rec2 = await loadStaticAnalysis(rec.id)
      if (rec2) {
        const plies = applyCachedAnalysis(game.plies, rec2)
        if (plies !== game.plies) game.plies = plies
      }
    } catch { /* 静态分析失败不影响打开 */ }
    loadGameObject(game)
    setTab('play')
    setSheetTab(BOARD_HOME)
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
      <div className="master-library-header">
        <h3>大师棋谱库</h3>
        <div className="master-library-status">
          <span style={{ fontSize: 12, color: '#888' }}>
            {info ? `已加载 ${info.loaded}/${info.total} 局` : `共 ${games.length} 局`}
            {cachedCount ? ` · 已预分析 ${cachedCount}` : ''}
          </span>
        </div>
        <div className="master-library-actions">
          <button className={`btn btn-sm ${preRunning ? 'btn-active' : ''}`}
            title={preRunning
              ? '停止批量预分析'
              : '用引擎批量分析各局关键点（吃子/将军）并缓存，拆解判定更准更快'}
            onClick={togglePreanalysis}>
            {preRunning ? '⏹ 停止' : '🧠 预分析'}
          </button>
          <button className="btn btn-sm btn-active" title="随机选一局，猜大师的每一步"
            onClick={() => useStore.getState().startMasterQuiz()}>
            🎯 名局拆解
          </button>
          <button className={`btn btn-sm ${insightsOpen ? 'btn-active' : ''}`}
            title="141k 局棋谱统计分析：开局体系/棋手稳健度/失误集锦"
            onClick={() => setInsightsOpen(v => !v)}>
            📊 数据洞察
          </button>
        </div>
      </div>

      {insightsOpen && <InsightsPanel />}

      {/* 预分析进度 */}
      {preRunning && preProgress && (
        <div className="controls-row" style={{ marginBottom: 6, fontSize: 12, color: '#9a9aa8' }}>
          🧠 {preProgress.gamesDone}/{preProgress.gamesTotal} 局 ·
          第 {preProgress.positionsDone}/{preProgress.positionsTotal} 点：{preProgress.currentTitle}
        </div>
      )}

      {/* 大类 */}
      <div className="controls-row" style={{ marginBottom: 6 }}>
        {([['all', `全部`], ['opening', '开局'], ['endgame', '实战残局']] as [Category, string][]).map(([c, label]) => (
          <button key={c} className={`btn btn-sm ${category === c ? 'btn-active' : ''}`}
            onClick={() => { setCategory(c); setFamily('all'); setVisible(PAGE_SIZE) }}>
            {label}
          </button>
        ))}
      </div>

      {/* 结果筛选 */}
      <div className="controls-row" style={{ marginBottom: 8 }}>
        {([['all', '全部'], ['红胜', '红胜'], ['黑胜', '黑胜'], ['和', '和棋']] as ['all' | '红胜' | '黑胜' | '和', string][]).map(([r, label]) => (
          <button key={r} className={`btn btn-sm ${result === r ? 'btn-active' : ''}`}
            onClick={() => { setResult(r); setVisible(PAGE_SIZE) }}>
            {label}
          </button>
        ))}
      </div>

      {/* 棋手筛选（可搜索下拉） */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input
          className="search-input"
          style={{ marginBottom: 0, paddingRight: player ? 30 : undefined }}
          placeholder={`搜索棋手筛选对局（已收录 ${players.length} 人）…`}
          value={player || playerInput}
          onChange={e => { setPlayer(''); setPlayerInput(e.target.value); setVisible(PAGE_SIZE) }}
          onFocus={() => setPlayerOpen(true)}
          onBlur={() => setTimeout(() => setPlayerOpen(false), 120)}
        />
        {player && (
          <button className="player-clear" title="清除棋手筛选"
            onClick={() => { setPlayer(''); setPlayerInput(''); setVisible(PAGE_SIZE) }}>×</button>
        )}
        {playerOpen && (
          <div className="player-dropdown">
            {playerMatches.map(p => (
              <div key={p.name} className="player-option"
                onMouseDown={e => {
                  e.preventDefault()
                  setPlayer(p.name); setPlayerInput(''); setPlayerOpen(false); setVisible(PAGE_SIZE)
                }}>
                <span>{p.name}</span>
                <span className="player-option-count">{p.count}局</span>
              </div>
            ))}
            {playerMatches.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-3)' }}>无匹配棋手</div>
            )}
          </div>
        )}
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

      {/* 棋手页（选中棋手时的聚合卡） */}
      {profile && profile.total > 0 && (
        <div className="player-profile">
          <div className="player-profile-head">
            <span className="player-profile-name">👤 {profile.name}</span>
            <span className="player-profile-total">{profile.total} 局 · 收录</span>
            <button className="player-clear" title="关闭棋手页" onClick={() => { setPlayer(''); setPlayerInput('') }}>×</button>
          </div>
          <div className="player-profile-stats">
            <div className="pp-side">
              <span className="pp-side-label">执红</span>
              <span className="pp-wdl">胜 {profile.asRed.redWin} · 和 {profile.asRed.draw} · 负 {profile.asRed.blackWin}</span>
            </div>
            <div className="pp-side">
              <span className="pp-side-label">执黑</span>
              <span className="pp-wdl">胜 {profile.asBlack.blackWin} · 和 {profile.asBlack.draw} · 负 {profile.asBlack.redWin}</span>
            </div>
          </div>
          {profile.topOpenings.length > 0 && (
            <div className="player-profile-openings">
              <span className="pp-side-label">常用开局</span>
              {profile.topOpenings.map(o => (
                <span key={o.name} className="pp-opening">{o.name} {o.count}</span>
              ))}
            </div>
          )}
          {playerInsight && (
            <div className="player-profile-insight">
              <span className="pp-side-label">稳健度（141k 局统计）</span>
              <span className="pp-insight">
                失误率 {playerInsight.mistakeRate}% · 严重失误 {playerInsight.blunderRate}%
              </span>
            </div>
          )}
        </div>
      )}

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
