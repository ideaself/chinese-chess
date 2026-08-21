/**
 * 控制面板 - 完整版
 *
 * 对战模式: 新游戏 / 悔棋 / 提示 / 认输 / 翻转棋盘
 * 重放模式: |< < ▶ > >| / 速度
 * 通用: 难度选择
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
  const boardFlipped = useStore(s => s.boardFlipped)
  const hintInfo = useStore(s => s.hintInfo)

  const startNewGame = useStore(s => s.startNewGame)
  const undo = useStore(s => s.undo)
  const restart = useStore(s => s.restart)
  const flipBoard = useStore(s => s.flipBoard)
  const setDifficulty = useStore(s => s.setDifficulty)
  const aiHint = useStore(s => s.aiHint)
  const resign = useStore(s => s.resign)
  const saveCurrentGame = useStore(s => s.saveCurrentGame)
  const goToStart = useStore(s => s.goToStart)
  const goToEnd = useStore(s => s.goToEnd)
  const goBack = useStore(s => s.goBack)
  const goForward = useStore(s => s.goForward)
  const loadGame = useStore(s => s.loadGame)
  const exportCurrentPGN = useStore(s => s.exportCurrentPGN)

  const [showNewGame, setShowNewGame] = useState(false)
  const [autoPlay, setAutoPlay] = useState(false)
  // 自动播放速度初始值来自设置（计划第20节）
  const [autoPlaySpeed, setAutoPlaySpeed] = useState(() => getSettings().autoPlaySpeed)

  /** 按默认执棋设置开新局 */
  const startWithDefaultSide = () => {
    const side = getSettings().defaultSide
    if (side === 'random') {
      startNewGame(difficulty, Math.random() < 0.5 ? 'w' : 'b')
    } else {
      startNewGame(difficulty, side)
    }
    setShowNewGame(false)
  }

  // 自动播放
  useEffect(() => {
    if (!autoPlay || mode !== 'replay') return
    if (currentPlyIndex >= game.plies.length) { setAutoPlay(false); return }
    const timer = setTimeout(() => goForward(), autoPlaySpeed)
    return () => clearTimeout(timer)
  }, [autoPlay, currentPlyIndex, game.plies.length, autoPlaySpeed, mode, goForward])

  return (
    <div className="controls">
      {/* 难度选择 */}
      {mode === 'play' && (
        <div className="controls-row">
          <span className="label">难度：</span>
          {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map(d => (
            <button key={d} className={`btn btn-sm ${difficulty === d ? 'btn-active' : ''}`}
              onClick={() => setDifficulty(d)}>
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>
      )}

      {/* 提示结果 - 计划第6.4节 */}
      {mode === 'play' && hintInfo && (
        <div className="hint-banner">
          💡 推荐 <b>{hintInfo.moveCn}</b>
          <span className="hint-score">
            评估 {(hintInfo.score / 100 >= 0 ? '+' : '') + (hintInfo.score / 100).toFixed(2)}
          </span>
        </div>
      )}

      {/* 对战模式按钮 */}
      {mode === 'play' && (
        <div className="controls-row">
          <button className="btn" onClick={() => setShowNewGame(!showNewGame)}>🎮 新对局</button>
          <button className="btn" onClick={undo} disabled={isThinking || currentPlyIndex < 2}>↺ 悔棋</button>
          <button className="btn" onClick={() => aiHint()} disabled={!engineReady || isThinking}>
            {isThinking ? '思考中…' : '💡 提示'}
          </button>
          <button className="btn" onClick={resign}>🏳 认输</button>
          <button className="btn" onClick={flipBoard}>↕ 翻转</button>
        </div>
      )}

      {/* 新对局面板 */}
      {showNewGame && mode === 'play' && (
        <div className="controls-row" style={{ gap: 6 }}>
          <button className="btn btn-active" onClick={startWithDefaultSide}>⭐ 按默认</button>
          <button className="btn btn-active" onClick={() => { startNewGame(difficulty, 'w'); setShowNewGame(false) }}>执红先行</button>
          <button className="btn btn-active" onClick={() => { startNewGame(difficulty, 'b'); setShowNewGame(false) }}>执黑后行</button>
          <button className="btn btn-active" onClick={() => { startNewGame(difficulty, Math.random() < 0.5 ? 'w' : 'b'); setShowNewGame(false) }}>随机</button>
        </div>
      )}

      {/* 重放模式按钮 */}
      {mode === 'replay' && (
        <>
          <div className="controls-row">
            <button className="btn" onClick={goToStart}>⏮</button>
            <button className="btn" onClick={goBack} disabled={currentPlyIndex <= 0}>◀</button>
            <button className={`btn ${autoPlay ? 'btn-active' : ''}`}
              onClick={() => setAutoPlay(!autoPlay)}>
              {autoPlay ? '⏸' : '▶'}
            </button>
            <button className="btn" onClick={goForward} disabled={currentPlyIndex >= game.plies.length} title="下一步">⏵</button>
            <button className="btn" onClick={goToEnd}>⏭</button>
            <button className="btn" onClick={flipBoard}>↕ 翻转</button>
          </div>
          <div className="controls-row">
            <span className="label">速度:</span>
            <button className={`btn btn-sm ${autoPlaySpeed === 2000 ? 'btn-active' : ''}`} onClick={() => setAutoPlaySpeed(2000)}>慢</button>
            <button className={`btn btn-sm ${autoPlaySpeed === 1000 ? 'btn-active' : ''}`} onClick={() => setAutoPlaySpeed(1000)}>中</button>
            <button className={`btn btn-sm ${autoPlaySpeed === 500 ? 'btn-active' : ''}`} onClick={() => setAutoPlaySpeed(500)}>快</button>
            <button className={`btn btn-sm ${autoPlaySpeed === 200 ? 'btn-active' : ''}`} onClick={() => setAutoPlaySpeed(200)}>极快</button>
            <span className="label" style={{ marginLeft: 8 }}>
              {currentPlyIndex}/{game.plies.length}步
            </span>
          </div>
          {/* 复盘时随时可开新局（计划第6.5节） */}
          <div className="controls-row">
            <button className="btn btn-primary" style={{ padding: '8px 16px' }}
              onClick={() => {
                const side = getSettings().defaultSide
                startNewGame(difficulty, side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side)
              }}>
              ⚔ 新对局
            </button>
            <button className="btn" onClick={() => {
              const pgn = exportCurrentPGN()
              const blob = new Blob([pgn], { type: 'text/plain' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `xiangqi_${game.id}.pgn`
              a.click()
              URL.revokeObjectURL(url)
            }}>📥 导出PGN</button>
          </div>
        </>
      )}

      {/* 引擎状态 */}
      <div className="engine-status">
        {engineReady ? (
          <span className="status-ready">● 引擎就绪</span>
        ) : (
          <span className="status-loading">● 引擎加载中…</span>
        )}
        {isThinking && <span className="status-thinking"> 思考中…</span>}
      </div>
    </div>
  )
}
