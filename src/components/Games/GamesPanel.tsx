/**
 * 棋谱页容器 - 子导航: 棋谱列表 | 错题本 | 训练
 */

import React, { useState } from 'react'
import { GameList } from '../GameList/GameList'
import { MistakeBook } from './MistakeBook'
import { TrainingPanel } from './TrainingPanel'

type SubTab = 'list' | 'mistakes' | 'training'

export const GamesPanel: React.FC = () => {
  const [tab, setTab] = useState<SubTab>('list')

  return (
    <div className="games-panel">
      <div className="sub-nav">
        {([['list', '棋谱'], ['mistakes', '错题本'], ['training', '训练']] as [SubTab, string][]).map(([t, label]) => (
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
