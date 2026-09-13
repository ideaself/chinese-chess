/**
 * 天天象棋残局挑战（历史存档）列表
 *
 * 数据: public/weekly-challenges.json（scripts/weekly-challenges.mjs 抓取东萍存档）
 * 交互: 期号/日期搜索、通关标记、点击任一期即刻挑战（红先，AI 执黑）
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { loadChallenges, getClearedChallenges } from '../../game/challenges'
import type { WeeklyChallenge } from '../../game/challenges'

export const WeeklyChallenges: React.FC = () => {
  const startWeeklyChallenge = useStore(s => s.startWeeklyChallenge)
  const [items, setItems] = useState<WeeklyChallenge[] | null>(null)
  const [error, setError] = useState(false)
  const [kw, setKw] = useState('')
  const [cleared, setCleared] = useState<Set<number>>(() => getClearedChallenges())

  useEffect(() => {
    let alive = true
    loadChallenges()
      .then(list => { if (alive) { setItems(list); setCleared(getClearedChallenges()) } })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [])

  const list = useMemo(() => {
    if (!items) return []
    const k = kw.trim()
    if (!k) return [...items].sort((a, b) => b.n - a.n)
    return items
      .filter(c => String(c.n).includes(k) || c.date.includes(k) || c.title.includes(k))
      .sort((a, b) => b.n - a.n)
  }, [items, kw])

  const first = items?.length ? items[0].n : null
  const last = items?.length ? items[items.length - 1].n : null

  return (
    <div className="weekly-challenges">
      <div className="wc-head">
        <div className="wc-title">🏆 天天象棋 · 残局挑战</div>
        <input
          className="settings-input wc-search"
          placeholder="按期号 / 日期搜索"
          value={kw}
          onChange={e => setKw(e.target.value)}
        />
      </div>
      <div className="wc-hint">
        历史存档第 {first}~{last} 期，共 {items ? items.length : '…'} 期（缺少数早期期号）。
        选一期随时挑战：红先，AI 执黑应战；破局即记为通关。
      </div>
      {error && <div className="panel-hint">题库加载失败，请检查网络后重试</div>}
      {!items && !error && <div className="panel-hint">加载中…</div>}
      {items && (
        <div className="wc-list">
          {list.map(c => {
            const done = cleared.has(c.n)
            return (
              <button key={c.n} className="wc-row" onClick={() => startWeeklyChallenge(c.n)}>
                <span className={`wc-n ${done ? 'wc-done' : ''}`}>第{c.n}期</span>
                <span className="wc-date">{c.date}</span>
                <span className={`wc-go ${done ? 'wc-cleared' : ''}`}>{done ? '✓ 已通关' : '挑战 →'}</span>
              </button>
            )
          })}
          {list.length === 0 && <div className="panel-hint">没有匹配的期号</div>}
        </div>
      )}
      <div className="wc-source">数据来源：东萍象棋网网友上传存档，仅供个人打谱</div>
    </div>
  )
}
