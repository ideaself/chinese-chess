/**
 * 移动端棋盘主页操作条
 *
 * 全屏棋盘下方常驻的细操作条：对战/复盘核心动作 + ⚙ 打开完整对局面板。
 * 桌面端不使用（桌面有右侧栏）。
 */

import React, { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import type { SideControl } from '../../store/useStore'
import { getSettings } from '../../game/storage'
import { TriRight } from '../ui/icons'

export const MobilePlayBar: React.FC = () => {
  const mode = useStore(s => s.mode)
  const engineReady = useStore(s => s.engineReady)
  const isThinking = useStore(s => s.isThinking)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const game = useStore(s => s.game)
  const sideControl = useStore(s => s.sideControl)
  const autoPlay = useStore(s => s.autoPlaying)
  const setSheetTab = useStore(s => s.setSheetTab)
  const variation = useStore(s => s.variation)
  const variationGo = useStore(s => s.variationGo)
  const exitVariation = useStore(s => s.exitVariation)

  const undo = useStore(s => s.undo)
  const flipBoard = useStore(s => s.flipBoard)
  const aiHint = useStore(s => s.aiHint)
  const resign = useStore(s => s.resign)
  const offerDraw = useStore(s => s.offerDraw)
  const goToStart = useStore(s => s.goToStart)
  const goToEnd = useStore(s => s.goToEnd)
  const goBack = useStore(s => s.goBack)
  const goForward = useStore(s => s.goForward)
  const setAutoPlay = useStore(s => s.setAutoPlaying)
  const startReplayVariation = useStore(s => s.startReplayVariation)

  const [autoPlaySpeed, setAutoPlaySpeed] = useState(() => getSettings().autoPlaySpeed)

  const hotseat = sideControl.w === 'human' && sideControl.b === 'human'
  const demo = sideControl.w === 'ai' && sideControl.b === 'ai'
  const singleHuman = !hotseat && !demo
  const over = game.result !== '*'

  useEffect(() => {
    if (!autoPlay || mode !== 'replay' || variation) return
    if (currentPlyIndex >= game.plies.length) { setAutoPlay(false); return }
    const timer = setTimeout(() => goForward(), autoPlaySpeed)
    return () => clearTimeout(timer)
  }, [autoPlay, currentPlyIndex, game.plies.length, autoPlaySpeed, mode, goForward, setAutoPlay, variation])

  // 分支推演（试走变化）：棋盘常驻可见，直接点子落子；本操作条提供前进/后退与退出/分支列表
  if (variation) {
    const line = variation.currentId === null ? variation.mainLine : variation.branches.find(b => b.id === variation.currentId)
    const moves = line?.moves ?? []
    const index = variation.currentPly
    const branchCount = (variation.mainLine ? 1 : 0) + variation.branches.length
    return (
      <div className="mobile-play-bar">
        <div className="mpb-transport">
          <button className="mpb-btn" onClick={() => variationGo(0)} title="起点">⏮</button>
          <button className="mpb-btn" onClick={() => variationGo(index - 1)} disabled={index <= 0} title="上一步">◀</button>
          <button className={`mpb-btn mpb-main`} onClick={() => variationGo(index + 1)} disabled={index >= moves.length} title="下一步"><TriRight /></button>
          <button className="mpb-btn" onClick={() => variationGo(moves.length)} title="终点">⏭</button>
        </div>
        <div className="mpb-actions">
          <button className="mpb-btn" onClick={() => setSheetTab('variation')} title="分支列表">📑 分支 {branchCount}</button>
          <button className="mpb-btn" onClick={flipBoard} title="翻转棋盘">⇅</button>
          <button className="mpb-btn wide" onClick={() => exitVariation()}>✕ 退出推演</button>
        </div>
        <div className="mpb-hint">点棋子试走；同局面可走不同手形成多分支，自动评对比主变</div>
      </div>
    )
  }

  if (mode === 'replay') {
    return (
      <div className="mobile-play-bar">
        <div className="mpb-transport">
          <button className="mpb-btn" onClick={goToStart} title="开局">⏮</button>
          <button className="mpb-btn" onClick={goBack} disabled={currentPlyIndex <= 0} title="上一步">◀</button>
          <button className={`mpb-btn mpb-main ${autoPlay ? 'mpb-playing' : ''}`}
            onClick={() => setAutoPlay(!autoPlay)} title="自动播放">
            {autoPlay ? '⏸' : '▶'}
          </button>
          <button className="mpb-btn" onClick={goForward} disabled={currentPlyIndex >= game.plies.length} title="下一步"><TriRight /></button>
          <button className="mpb-btn" onClick={goToEnd} title="末局">⏭</button>
        </div>
        <div className="mpb-actions">
          <button className="mpb-btn wide" onClick={() => setSheetTab('newgame')}>⚔ 新对局</button>
          <button className="mpb-btn" onClick={flipBoard} title="翻转棋盘">⇅</button>
          <button className="mpb-btn" onClick={() => startReplayVariation()} title="试走变化">🌿</button>
          <button className="mpb-btn" onClick={() => setSheetTab('controls')} title="更多">⚙</button>
        </div>
      </div>
    )
  }

  // 对战 / 摆棋 / 错题 / 拆解 / 训练等模式：棋盘下常驻核心操作
  return (
    <div className="mobile-play-bar">
        <div className="mpb-actions">
          <button className="mpb-btn wide" onClick={() => setSheetTab('newgame')}>🎮 新对局</button>
        <button className="mpb-btn" onClick={undo}
          disabled={isThinking || currentPlyIndex < 1 || over || demo}
          title={demo ? '演示模式不可悔棋' : over ? '对局已结束' : '悔棋'}>↺ 悔棋</button>
        <button className={`mpb-btn${isThinking ? ' mpb-thinking' : ''}`} onClick={() => aiHint()}
          disabled={!engineReady || isThinking || demo} title={isThinking ? '思考中' : '提示'}>
          💡 提示</button>
        {singleHuman && (
          <button className="mpb-btn" onClick={() => { if (confirm('确定认输？本局将判负并保存。')) resign() }}
            disabled={over} title="认输">🏳</button>
        )}
        {singleHuman && !over && (
          <button className="mpb-btn" onClick={() => { if (confirm('确认求和？本局将判为和棋并保存。')) offerDraw() }}
            title="求和">🤝</button>
        )}
        <button className="mpb-btn" onClick={flipBoard} title="翻转棋盘">⇅</button>
        <button className="mpb-btn" onClick={() => setSheetTab('controls')} title="更多设置">⚙</button>
      </div>
    </div>
  )
}
