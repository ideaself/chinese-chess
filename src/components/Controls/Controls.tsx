/**
 * 控制面板
 *
 * 对战模式: 难度分段选择 / 操作网格 / 新对局面板
 * 重放模式: 运输条 + 速度 + 新对局/导出
 */

import React, { useState, useEffect } from 'react'
import { useStore, DIFFICULTY_LABELS } from '../../store/useStore'
import type { Difficulty, SideControl } from '../../store/useStore'
import { getSettings } from '../../game/storage'
import { exportGameImage } from '../../game/imageExport'
import { TriRight } from '../ui/icons'
import { CoachPanel } from '../Games/CoachPanel'

export const Controls: React.FC = () => {
  const mode = useStore(s => s.mode)
  const difficulty = useStore(s => s.difficulty)
  const engineReady = useStore(s => s.engineReady)
  const isThinking = useStore(s => s.isThinking)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const game = useStore(s => s.game)
  const sideControl = useStore(s => s.sideControl)

  const startNewGame = useStore(s => s.startNewGame)
  const restart = useStore(s => s.restart)
  const undo = useStore(s => s.undo)
  const flipBoard = useStore(s => s.flipBoard)
  const setDifficulty = useStore(s => s.setDifficulty)
  const aiHint = useStore(s => s.aiHint)
  const resign = useStore(s => s.resign)
  const offerDraw = useStore(s => s.offerDraw)
  const goToStart = useStore(s => s.goToStart)
  const goToEnd = useStore(s => s.goToEnd)
  const goBack = useStore(s => s.goBack)
  const goForward = useStore(s => s.goForward)
  const exportCurrentPGN = useStore(s => s.exportCurrentPGN)

  const autoPlay = useStore(s => s.autoPlaying)
  const setAutoPlay = useStore(s => s.setAutoPlaying)

  const [showNewGame, setShowNewGame] = useState(false)
  // 自动播放速度初始值来自设置（计划第20节）
  const [autoPlaySpeed, setAutoPlaySpeed] = useState(() => getSettings().autoPlaySpeed)

  /** 对局角色 */
  const hotseat = sideControl.w === 'human' && sideControl.b === 'human'
  const demo = sideControl.w === 'ai' && sideControl.b === 'ai'
  const singleHuman = !hotseat && !demo

  /** 按默认执棋设置开新局 */
  const startWithDefaultSide = () => {
    const side = getSettings().defaultSide
    startNewGame(difficulty, side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side)
    setShowNewGame(false)
  }

  /** 按对局角色开新局 */
  const startRole = (role: 'red' | 'black' | 'random' | 'hotseat' | 'demo') => {
    if (role === 'hotseat') startNewGame(difficulty, 'w', { w: 'human', b: 'human' })
    else if (role === 'demo') startNewGame(difficulty, 'w', { w: 'ai', b: 'ai' })
    else {
      const side = role === 'red' ? 'w' : role === 'black' ? 'b' : (Math.random() < 0.5 ? 'w' : 'b')
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

  // ── 对战模式 ──
  if (mode === 'play') {
    return (
      <div className="controls">
        <div className="ctrl-section">
          <div className="ctrl-title">
            {hotseat ? '双人对战 · 难度（AI 提示用）' : demo ? 'AI 对弈演示 · 难度' : 'AI 难度'}
          </div>
          <select
            className="settings-select difficulty-select"
            value={difficulty}
            onChange={e => setDifficulty(e.target.value as Difficulty)}
            disabled={demo}
          >
            {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map(d => (
              <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
            ))}
          </select>
        </div>

        {hotseat && (
          <div className="hint-banner">👥 双人对战 — 同屏轮流行棋，红先</div>
        )}
        {demo && (
          <div className="hint-banner">🤖 AI 对弈演示中 — 点「新对局」可退出</div>
        )}

        <div className="action-grid">
          <button className={`btn ${showNewGame ? 'btn-active' : ''}`} onClick={() => setShowNewGame(!showNewGame)}>
            🎮 新对局
          </button>
          <button className="btn"
            onClick={undo}
            disabled={isThinking || currentPlyIndex < 1 || game.result !== '*' || demo}
            title={demo ? '演示模式不可悔棋' : isThinking ? '对方思考中，暂不能悔棋' : '悔棋（撤回到你上一次行棋前）'}>
            ↺ 悔棋
          </button>
          <button className="btn" onClick={() => aiHint()} disabled={!engineReady || isThinking || demo}>
            {isThinking ? '⏳ 思考中' : '💡 提示'}
          </button>
          <button className="btn" onClick={() => { if (confirm('确认求和？本局将判为和棋并保存。')) offerDraw() }} disabled={isThinking || game.result !== '*' || demo} title="判为和棋并保存">🤝 求和</button>
          <button className="btn" onClick={() => { if (confirm('确定认输？本局将判负并保存。')) resign() }} disabled={game.result !== '*' || !singleHuman} title={singleHuman ? '判负并保存' : '仅人机对局可认输'}>🏳 认输</button>
          <button className="btn" onClick={flipBoard}>⇅ 翻转</button>
        </div>

        {showNewGame && (
          <div className="newgame-panel">
            <div className="ctrl-title">对局角色</div>
            <div className="action-grid cols-2">
              <button className="btn" onClick={() => startRole('red')}>🔴 我执红（AI 执黑）</button>
              <button className="btn" onClick={() => startRole('black')}>⚫ 我执黑（AI 执红）</button>
              <button className="btn" onClick={() => startRole('random')}>🎲 随机执子</button>
              <button className="btn" onClick={() => startRole('hotseat')}>👥 双人对战</button>
              <button className="btn" style={{ gridColumn: 'span 2' }} onClick={() => startRole('demo')}>🤖 AI 对弈演示（红 vs 黑）</button>
            </div>
            <div className="ctrl-title" style={{ marginTop: 8 }}>快捷</div>
            <div className="action-grid cols-2">
              <button className="btn" onClick={startWithDefaultSide}>⭐ 按默认设置</button>
              <button className="btn" onClick={() => { restart(); setShowNewGame(false) }}>🔄 重开本局</button>
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
            <button className="t-btn" onClick={goForward} disabled={currentPlyIndex >= game.plies.length} title="下一步"><TriRight /></button>
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
            <span className="kbd-hint" style={{ marginLeft: 'auto' }}>
              <kbd>←</kbd><kbd>→</kbd> 步进 · <kbd>空格</kbd> 播放
            </span>
          </div>
        </div>

        <div className="action-grid">
          <button className="btn btn-primary" onClick={() => {
            const side = getSettings().defaultSide
            startNewGame(difficulty, side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side)
          }}>
            ⚔ 新对局
          </button>
          <button className="btn" onClick={flipBoard}>⇅ 翻转</button>
          <button className="btn" onClick={() => exportGameImage(game, { plyIndex: currentPlyIndex, mode: 'share' })}>🖼 导出/分享图片</button>
          <button className="btn" onClick={() => {
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

        {/* 变化试走入口：从当前局面自由分支 */}
        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 8 }}
          title="从当前局面在棋盘上试走自己的着法，随时回到主线"
          onClick={() => { const s = useStore.getState(); s.startReplayVariation(); s.setSheetTab('variation') }}>
          🌿 试走变化（分支推演）
        </button>

        {/* 教练指导（复盘研习） */}
        <CoachPanel />

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
