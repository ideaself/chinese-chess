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
import { Icon } from '../ui/icons'

export const NewGamePanel: React.FC = () => {
  const difficulty = useStore(s => s.difficulty)
  const setDifficulty = useStore(s => s.setDifficulty)
  const startNewGame = useStore(s => s.startNewGame)
  const restart = useStore(s => s.restart)
  const setSheetTab = useStore(s => s.setSheetTab)
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)

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

      <div className="ctrl-title">时间制</div>
      <div className="action-grid cols-2">
        {([[0, '不限时'], [300000, '5 分钟'], [600000, '10 分钟'], [900000, '15 分钟'], [1800000, '30 分钟']] as [number, string][]).map(([v, label]) => (
          <button key={v}
            className={`btn${settings.timeControlBaseMs === v ? ' btn-active' : ''}`}
            onClick={() => updateSettings({ timeControlBaseMs: v })}>
            {label}
          </button>
        ))}
      </div>
      {settings.timeControlBaseMs > 0 && (
        <div className="ctrl-hint" style={{ marginTop: 6 }}>
          每步加秒：
          {([[0, '不加'], [3000, '3 秒'], [5000, '5 秒']] as [number, string][]).map(([v, label]) => (
            <button key={v}
              className={`filter-btn${settings.timeControlIncMs === v ? ' btn-active' : ''}`}
              style={{ marginLeft: 6 }}
              onClick={() => updateSettings({ timeControlIncMs: v })}>{label}</button>
          ))}
        </div>
      )}

      <div className="ctrl-title">对局角色</div>
      <div className="action-grid cols-2">
        <button className="btn ng-role" onClick={() => startRole('red')}>
          <span className="side-dot dot-red" /> 玩家执红 · AI执黑
        </button>
        <button className="btn ng-role" onClick={() => startRole('black')}>
          <span className="side-dot dot-black" /> 玩家执黑 · AI执红
        </button>
        <button className="btn ng-role" onClick={() => startRole('random')}>
          <Icon name="swap" size={17} /> 随机执子（玩家）
        </button>
        <button className="btn ng-role" onClick={() => startRole('hotseat')}>
          <Icon name="people" size={17} /> 双人对战（玩家 vs 玩家）
        </button>
        <button className="btn ng-role" style={{ gridColumn: 'span 2' }} onClick={() => startRole('demo')}>
          <Icon name="robot" size={17} /> AI 演示（AI vs AI）
        </button>
      </div>

      <div className="ctrl-title" style={{ marginTop: 8 }}>快捷</div>
      <div className="action-grid cols-2">
        <button className="btn ng-role" onClick={startDefault}>
          <Icon name="star" size={17} /> 按默认设置
        </button>
        <button className="btn ng-role" onClick={() => { restart(); close() }}>
          <Icon name="undo" size={17} /> 重开本局
        </button>
      </div>
    </div>
  )
}
