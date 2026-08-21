/**
 * 控制面板
 *
 * 对战模式: 难度分段选择 / 操作网格 / 新对局面板
 * 重放模式: 运输条 + 速度 + 新对局/导出
 */

import React, { useState, useEffect } from 'react'
import { useStore, DIFFICULTY_LABELS } from '../../store/useStore'
import type { Difficulty } from '../../store/useStore'
import { getSettings } from '../../game/storage'

export const Controls: React.FC = () => {
  const mode = useStore(s => s.mode)
  const difficulty = useStore(s => s.difficulty)
  const engineReady = useStore(s => s.engineReady)
  const isThinking = useStore(s => s.isThinking)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const game = useStore(s => s.game)
  const hintInfo = useStore(s => s.hintInfo)

  const startNewGame = useStore(s => s.startNewGame)
  const undo = useStore(s => s.undo)
  const flipBoard = useStore(s => s.flipBoard)
  const setDifficulty = useStore(s => s.setDifficulty)
  const aiHint = useStore(s => s.aiHint)
  const resign = useStore(s => s.resign)
  const goToStart = useStore(s => s.goToStart)
  const goToEnd = useStore(s => s.goToEnd)
  const goBack = useStore(s => s.goBack)
  const goForward = useStore(s => s.goForward)
  const exportCurrentPGN = useStore(s => s.exportCurrentPGN)

  const [showNewGame, setShowNewGame] = useState(false)
  const [autoPlay, setAutoPlay] = useState(false)
  // 自动播放速度初始值来自设置（计划第20节）
  const [autoPlaySpeed, setAutoPlaySpeed] = useState(() => getSettings().autoPlaySpeed)

  /** 按默认执棋设置开新局 */
  const startWithDefaultSide = () => {
    const side = getSettings().defaultSide
    startNewGame(difficulty, side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side)
    setShowNewGame(false)
  }

  // 自动播放
  useEffect(() => {
    if (!autoPlay || mode !== 'replay') return
    if (currentPlyIndex >= game.plies.length) { setAutoPlay(false); return }
    const timer = setTimeout(() => goForward(), autoPlaySpeed)
    return () => clearTimeout(timer)
  }, [autoPlay, currentPlyIndex, game.plies.length, autoPlaySpeed, mode, goForward])

  // ── 对战模式 ──
  if (mode === 'play') {
    return (
      <div className="controls">
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

        {hintInfo && (
          <div className="hint-banner">
            💡 推荐 <b>{hintInfo.moveCn}</b>
            <span className="hint-score">
              {(hintInfo.score / 100 >= 0 ? '+' : '') + (hintInfo.score / 100).toFixed(2)}
            </span>
          </div>
        )}

        <div className="action-grid">
          <button className={`btn ${showNewGame ? 'btn-active' : ''}`} onClick={() => setShowNewGame(!showNewGame)}>
            🎮 新对局
          </button>
          <button className="btn" onClick={undo} disabled={isThinking || currentPlyIndex < 2}>↺ 悔棋</button>
          <button className="btn" onClick={() => aiHint()} disabled={!engineReady || isThinking}>
            {isThinking ? '⏳ 思考中' : '💡 提示'}
          </button>
          <button className="btn" onClick={resign} disabled={game.result !== '*'}>🏳 认输</button>
          <button className="btn" onClick={flipBoard}>⇅ 翻转</button>
        </div>

        {showNewGame && (
          <div className="newgame-panel">
            <div className="ctrl-title">选择执棋</div>
            <div className="action-grid cols-2">
              <button className="btn" onClick={startWithDefaultSide}>⭐ 按默认</button>
              <button className="btn" onClick={() => { startNewGame(difficulty, Math.random() < 0.5 ? 'w' : 'b'); setShowNewGame(false) }}>🎲 随机</button>
              <button className="btn" onClick={() => { startNewGame(difficulty, 'w'); setShowNewGame(false) }}>🔴 执红先行</button>
              <button className="btn" onClick={() => { startNewGame(difficulty, 'b'); setShowNewGame(false) }}>⚫ 执黑后行</button>
            </div>
          </div>
        )}

        <EngineStatus />
      </div>
    )
  }

  // ── 重放模式 ──
  if (mode === 'replay') {
    return (
      <div className="controls">
        <div className="ctrl-section">
          <div className="ctrl-title">复盘浏览 · 第 {currentPlyIndex}/{game.plies.length} 步</div>
          <div className="transport">
            <button className="t-btn" onClick={goToStart} title="开局">⏮</button>
            <button className="t-btn" onClick={goBack} disabled={currentPlyIndex <= 0} title="上一步">◀</button>
            <button className={`t-btn t-main ${autoPlay ? 't-playing' : ''}`}
              onClick={() => setAutoPlay(!autoPlay)} title="自动播放">
              {autoPlay ? '⏸' : '▶'}
            </button>
            <button className="t-btn" onClick={goForward} disabled={currentPlyIndex >= game.plies.length} title="下一步">⏵</button>
            <button className="t-btn" onClick={goToEnd} title="末局">⏭</button>
          </div>
          <div className="speed-row">
            <span className="label">速度</span>
            {[2000, 1000, 500, 200].map((v, i) => (
              <button key={v} className={`filter-btn ${autoPlaySpeed === v ? 'btn-active' : ''}`}
                onClick={() => setAutoPlaySpeed(v)}>
                {['慢', '中', '快', '极快'][i]}
              </button>
            ))}
          </div>
        </div>

        <div className="action-grid cols-2">
          <button className="btn btn-primary" onClick={() => {
            const side = getSettings().defaultSide
            startNewGame(difficulty, side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side)
          }}>
            ⚔ 新对局
          </button>
          <button className="btn" onClick={flipBoard}>⇅ 翻转</button>
          <button className="btn" style={{ gridColumn: '1 / -1' }} onClick={() => {
            const pgn = exportCurrentPGN()
            const blob = new Blob([pgn], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `xiangqi_${game.id}.pgn`
            a.click()
            URL.revokeObjectURL(url)
          }}>📥 导出 PGN</button>
        </div>

        <EngineStatus />
      </div>
    )
  }

  // ── 其他模式不显示对战控制 ──
  return null
}

const EngineStatus: React.FC = () => {
  const engineReady = useStore(s => s.engineReady)
  const isThinking = useStore(s => s.isThinking)
  return (
    <div className="engine-status">
      {engineReady
        ? <span className="status-ready">● 引擎就绪</span>
        : <span className="status-loading">● 引擎加载中…</span>}
      {isThinking && <span className="status-thinking">⚙ 思考中…</span>}
    </div>
  )
}
