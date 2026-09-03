/**
 * 移动端棋盘主页操作条
 *
 * 全屏棋盘下方常驻的细操作条：
 * - 复盘模式（仿天天象棋分析页）：菜单 / 棋谱导航 / 上一步 / 下一步 / 自我分析
 * - 对战等模式：新对局 / 悔棋 / 提示 / 认输 / 求和 / 翻转 / ⚙
 * 桌面端不使用（桌面有右侧栏）。
 */

import React, { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import type { SideControl } from '../../store/useStore'
import { getSettings } from '../../game/storage'
import { exportPGN } from '../../game/pgn'
import { boardToFen } from '../../game/board'
import { exportGameImage } from '../../game/imageExport'
import { BOARD_HOME } from '../../store/constants'
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
  const selfAnalysis = useStore(s => s.selfAnalysis)
  const setSelfAnalysis = useStore(s => s.setSelfAnalysis)
  const variationGo = useStore(s => s.variationGo)
  const exitVariation = useStore(s => s.exitVariation)
  const showToast = useStore(s => s.showToast)

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

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

  /** 进入自我分析（推演走子 + 实时引擎横幅） */
  const enterSelfAnalysis = () => {
    const s = useStore.getState()
    s.startReplayVariation()
    s.setSelfAnalysis(true)
  }

  /** 退出推演/自我分析 */
  const exitVar = () => {
    exitVariation()
    setSelfAnalysis(false)
  }

  // 分支推演（试走变化）：棋盘常驻可见，直接点子落子；本操作条提供前进/后退与退出/分支列表
  if (variation) {
    const line = variation.currentId === null ? variation.mainLine : variation.branches.find(b => b.id === variation.currentId)
    const moves = line?.moves ?? []
    const index = variation.currentPly
    const branchCount = (variation.mainLine ? 1 : 0) + variation.branches.length

    /** AI 在当前推演局面替走一手 */
    const aiMoveOnce = async () => {
      const s = useStore.getState()
      if (!s.engine || !s.engine.isReady || s.isThinking) return
      const best = await s.engine.go(boardToFen(s.board), [], undefined, 800)
      if (best && best.length >= 4) {
        s.variationTryMove(
          { col: best.charCodeAt(0) - 97, row: parseInt(best[1]) },
          { col: best.charCodeAt(2) - 97, row: parseInt(best[3]) },
        )
      }
    }

    return (
      <div className="mobile-play-bar">
        <div className="mpb-transport">
          <button className="mpb-btn" onClick={() => variationGo(0)} title="起点">⏮</button>
          <button className="mpb-btn" onClick={() => variationGo(index - 1)} disabled={index <= 0} title="上一步">◀</button>
          <button className={`mpb-btn mpb-main`} onClick={() => variationGo(index + 1)} disabled={index >= moves.length} title="下一步"><TriRight /></button>
          <button className="mpb-btn" onClick={() => variationGo(moves.length)} title="终点">⏭</button>
          {selfAnalysis && <button className="mpb-btn" onClick={() => { void aiMoveOnce() }} disabled={!engineReady || isThinking} title="AI 替走一手">🤖</button>}
        </div>
        <div className="mpb-actions">
          <button className="mpb-btn" onClick={() => setSheetTab('variation')} title="分支列表">📑 分支 {branchCount}</button>
          <button className="mpb-btn" onClick={flipBoard} title="翻转棋盘">⇅</button>
          <button className="mpb-btn wide" onClick={exitVar}>✕ 退出{selfAnalysis ? '自我分析' : '推演'}</button>
        </div>
        {!selfAnalysis && <div className="mpb-hint">点棋子试走；同局面可走不同手形成多分支，自动评对比主变</div>}
      </div>
    )
  }

  if (mode === 'replay') {
    return (
      <div className="mobile-play-bar">
        {menuOpen && (
          <>
            <div className="mpb-pop-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="mpb-pop-menu">
              <button onClick={() => {
                setMenuOpen(false)
                const s = useStore.getState()
                s.restart()
                s.setTab('play')
                s.setSheetTab(BOARD_HOME)
              }}>↩ 退出复盘</button>
              <button onClick={() => { setMenuOpen(false); flipBoard() }}>⇅ 翻转</button>
              <button onClick={() => { setMenuOpen(false); const s = useStore.getState(); s.setTab('games'); s.setSheetTab('games') }}>📚 棋谱库</button>
              <button onClick={() => { setMenuOpen(false); startReplayVariation() }}>🌿 试走变化</button>
              <button onClick={() => {
                setMenuOpen(false)
                void navigator.clipboard?.writeText(exportPGN(game))
                showToast('棋谱 PGN 已复制到剪贴板')
              }}>↗ 分享棋谱</button>
              <button onClick={() => {
                setMenuOpen(false)
                void exportGameImage(game, { plyIndex: currentPlyIndex, mode: 'share' })
              }}>🖼 分享局面</button>
              <button onClick={() => { setMenuOpen(false); enterSelfAnalysis() }}>🔍 自我分析</button>
            </div>
          </>
        )}
        {navOpen && (
          <>
            <div className="mpb-pop-backdrop" onClick={() => setNavOpen(false)} />
            <div className="mpb-pop-nav">
              <div className="mpb-nav-row">
                <button className="mpb-btn" onClick={goToStart} title="开局">⏮</button>
                <input type="range" min={0} max={game.plies.length} value={currentPlyIndex}
                  onChange={(e) => { const s = useStore.getState(); s.goToPly(parseInt(e.target.value)) }} />
                <button className="mpb-btn" onClick={goToEnd} title="末局">⏭</button>
              </div>
              <div className="mpb-nav-row">
                <span className="mpb-nav-pos">{currentPlyIndex}/{game.plies.length}</span>
                <button className={`mpb-btn ${autoPlay ? 'mpb-playing' : ''}`} onClick={() => setAutoPlay(!autoPlay)}>
                  {autoPlay ? '⏸ 暂停' : '▶ 自动播放'}
                </button>
              </div>
            </div>
          </>
        )}
        <div className="mpb-actions mpb-five">
          <button className="mpb-btn" onClick={() => setMenuOpen(true)} title="菜单">☰ 菜单</button>
          <button className="mpb-btn" onClick={() => setNavOpen(true)} title="棋谱导航">⇲ 导航</button>
          <button className="mpb-btn" onClick={goBack} disabled={currentPlyIndex <= 0} title="上一步">◀</button>
          <button className={`mpb-btn mpb-main`} onClick={goForward} disabled={currentPlyIndex >= game.plies.length} title="下一步"><TriRight /></button>
          <button className="mpb-btn mpb-analyze" onClick={enterSelfAnalysis} title="自我分析">📈 自我分析</button>
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
