/**
 * 移动端「新对局」覆盖层
 *
 * 仅展示对局角色与快捷按钮（不重复展示悔棋/提示/投降等，那些已在操作条）。
 * 选中任一按钮即开新局并自动关闭覆盖层。红黑明确标注「玩家 / AI」。
 */

import React from 'react'
import { useStore, DIFFICULTY_LABELS } from '../../store/useStore'
import type { Difficulty } from '../../store/useStore'
import { getSettings } from '../../game/storage'
import { BOARD_HOME } from '../../store/constants'

export const NewGamePanel: React.FC = () => {
  const difficulty = useStore(s => s.difficulty)
  const setDifficulty = useStore(s => s.setDifficulty)
  const startNewGame = useStore(s => s.startNewGame)
  const restart = useStore(s => s.restart)
  const setSheetTab = useStore(s => s.setSheetTab)

  const close = () => setSheetTab(BOARD_HOME)

  const startRole = (role: 'red' | 'black' | 'random' | 'hotseat' | 'demo') => {
    if (role === 'hotseat') startNewGame(difficulty, 'w', { w: 'human', b: 'human' })
    else if (role === 'demo') startNewGame(difficulty, 'w', { w: 'ai', b: 'ai' })
    else {
      const side = role === 'red' ? 'w' : role === 'black' ? 'b' : (Math.random() < 0.5 ? 'w' : 'b')
      startNewGame(difficulty, side)
    }
    close()
  }

  const startDefault = () => {
    const side = getSettings().defaultSide
    startNewGame(difficulty, side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side)
    close()
  }

  return (
    <div className="controls newgame-sheet">
      <div className="ctrl-section">
        <div className="ctrl-title">AI 难度</div>
        <select
          className="settings-select difficulty-select"
          value={difficulty}
          onChange={e => setDifficulty(e.target.value as Difficulty)}
        >
          {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map(d => (
            <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
          ))}
        </select>
      </div>

      <div className="ctrl-title">对局角色</div>
      <div className="action-grid cols-2">
        <button className="btn" onClick={() => startRole('red')}>🔴 玩家执红 · AI执黑</button>
        <button className="btn" onClick={() => startRole('black')}>⚫ 玩家执黑 · AI执红</button>
        <button className="btn" onClick={() => startRole('random')}>🎲 随机执子（玩家）</button>
        <button className="btn" onClick={() => startRole('hotseat')}>👥 双人对战（玩家 vs 玩家）</button>
        <button className="btn" style={{ gridColumn: 'span 2' }} onClick={() => startRole('demo')}>🤖 AI 演示（AI vs AI）</button>
      </div>

      <div className="ctrl-title" style={{ marginTop: 8 }}>快捷</div>
      <div className="action-grid cols-2">
        <button className="btn" onClick={startDefault}>⭐ 按默认设置</button>
        <button className="btn" onClick={() => { restart(); close() }}>🔄 重开本局</button>
      </div>
    </div>
  )
}
