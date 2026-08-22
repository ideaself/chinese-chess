/**
 * 棋谱页容器 - 子导航: 棋谱列表 | 错题本 | 训练
 * （子导航状态在 store，供训练计划等外部跳转）
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { GameList } from '../GameList/GameList'
import { MistakeBook } from './MistakeBook'
import { TrainingPanel } from './TrainingPanel'

export const GamesPanel: React.FC = () => {
  const tab = useStore(s => s.gamesSubTab)
  const setTab = useStore(s => s.setGamesSubTab)

  return (
    <div className="games-panel">
      <div className="sub-nav">
        {([['list', '棋谱'], ['mistakes', '错题本'], ['training', '训练']] as const).map(([t, label]) => (
          <button
            key={t}
            className={`filter-btn ${tab === t ? 'btn-active' : ''}`}
            onClick={() => setTab(t)}
          >{label}</button>
        ))}
      </div>
      {tab === 'list' && <GameList />}
      {tab === 'mistakes' && <MistakeBook />}
      {tab === 'training' && <TrainingPanel />}
    </div>
  )
}
