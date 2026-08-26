/**
 * 棋谱页容器 - 子导航: 棋谱列表 | 错题本 | 训练
 * （子导航状态在 store，供训练计划等外部跳转）
 */

import React, { useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { registerBackHandler } from '../../game/backNav'
import { GameList } from '../GameList/GameList'
import { MasterLibrary } from './MasterLibrary'
import { MistakeBook } from './MistakeBook'
import { TrainingPanel } from './TrainingPanel'

export const GamesPanel: React.FC = () => {
  const tab = useStore(s => s.gamesSubTab)
  const setTab = useStore(s => s.setGamesSubTab)

  // 子导航纳入返回栈：非列表页按返回先回「棋谱」
  useEffect(() => {
    if (tab === 'list') return
    return registerBackHandler(() => { setTab('list'); return true })
  }, [tab, setTab])

  return (
    <div className="games-panel">
      <div className="sub-nav">
        {([['list', '棋谱'], ['library', '大师库'], ['mistakes', '错题本'], ['training', '训练']] as const).map(([t, label]) => (
          <button
            key={t}
            className={`filter-btn ${tab === t ? 'btn-active' : ''}`}
            onClick={() => setTab(t)}
          >{label}</button>
        ))}
      </div>
      {tab === 'list' && <GameList />}
      {tab === 'library' && <MasterLibrary />}
      {tab === 'mistakes' && <MistakeBook />}
      {tab === 'training' && <TrainingPanel />}
    </div>
  )
}
