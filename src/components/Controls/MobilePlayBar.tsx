/**
 * 移动端棋盘主页操作条
 *
 * 全屏棋盘下方常驻的细操作条（图标 + 文字，单行，仿天天象棋）：
 * - 对战等模式：悔棋 / 提示 / 认输 / 求和 / 更多（新对局·翻转·设置）
 * - 复盘模式：菜单 / 导航 / 上一步 / 下一步 / 关键手 / 分析
 * 桌面端不使用（桌面有右侧栏）。
 */

import React, { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { exportPGN } from '../../game/pgn'
import { boardToFen } from '../../game/board'
import { exportGameImage } from '../../game/imageExport'
import { BOARD_HOME, MAX_UNDO_PER_GAME } from '../../store/constants'
import { findNextKeyPly, findPrevKeyPly } from '../../game/keyNav'
import { registerBackHandler } from '../../game/backNav'
import { Icon, type IconName } from '../ui/icons'

interface BarItem {
  icon: IconName
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  title?: string
}

const BarButton: React.FC<BarItem> = ({ icon, label, onClick, disabled, primary, title }) => (
  <button className={`mpb-ibtn${primary ? ' mpb-primary' : ''}`} onClick={onClick} disabled={disabled}
    title={title ?? label} aria-label={label}>
    <Icon name={icon} size={23} />
    <span>{label}</span>
  </button>
)

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
  const undoCount = useStore(s => s.undoCount)
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

  // 自动播放速度读写设置（复盘导航弹层内可直接调）
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const autoPlaySpeed = settings.autoPlaySpeed
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmKind, setConfirmKind] = useState<null | 'resign' | 'draw'>(null)

  // 弹层纳入返回栈：安卓返回键/右滑先关「更多」菜单与认输/求和确认条，
  // 而不是直接退出对战页（这些是组件内 state，store 的层级导航看不到）。
  useEffect(() => {
    if (!menuOpen && !navOpen && !moreOpen && !confirmKind) return
    return registerBackHandler(() => {
      if (confirmKind) { setConfirmKind(null); return true }
      if (moreOpen) { setMoreOpen(false); return true }
      if (menuOpen) { setMenuOpen(false); return true }
      if (navOpen) { setNavOpen(false); return true }
      return false
    })
  }, [menuOpen, navOpen, moreOpen, confirmKind])

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

  /** 跳到上一/下一关键手（失误级着法）；没有则提示先做整盘分析 */
  const jumpKey = (dir: 'prev' | 'next') => {
    const s = useStore.getState()
    const target = dir === 'next'
      ? findNextKeyPly(s.game, s.currentPlyIndex)
      : findPrevKeyPly(s.game, s.currentPlyIndex)
    if (target === null) {
      showToast(dir === 'next' ? '后面没有关键手了（可先做整盘分析）' : '前面没有关键手了')
      return
    }
    s.goToPly(target)
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
      <div className="mobile-play-bar mpb-play">
        <div className="mpb-icons">
          <BarButton icon="start" label="开局" onClick={() => variationGo(0)} />
          <BarButton icon="prev" label="上一步" onClick={() => variationGo(index - 1)} disabled={index <= 0} />
          <BarButton icon="next" label="下一步" onClick={() => variationGo(index + 1)} disabled={index >= moves.length} primary />
          <BarButton icon="end" label="末局" onClick={() => variationGo(moves.length)} />
          <BarButton icon="branch" label={`分支 ${branchCount}`} onClick={() => setSheetTab('variation')} />
          {selfAnalysis && (
            <BarButton icon="chart" label="AI替走" onClick={() => { void aiMoveOnce() }} disabled={!engineReady || isThinking} />
          )}
          <BarButton icon="close" label="退出" onClick={exitVar} />
        </div>
        {!selfAnalysis && <div className="mpb-hint">点棋子试走；同局面可走不同手形成多分支，自动评对比主变</div>}
      </div>
    )
  }

  if (mode === 'replay') {
    return (
      <div className="mobile-play-bar mpb-play">
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
              }}><Icon name="close" size={18} /> 退出复盘</button>
              <button onClick={() => { setMenuOpen(false); flipBoard() }}><Icon name="flip" size={18} /> 翻转棋盘</button>
              <button onClick={() => { setMenuOpen(false); const s = useStore.getState(); s.setTab('games'); s.setSheetTab('games') }}><Icon name="list" size={18} /> 棋谱库</button>
              <button onClick={() => { setMenuOpen(false); startReplayVariation() }}><Icon name="branch" size={18} /> 试走变化</button>
              <button onClick={() => {
                setMenuOpen(false)
                void navigator.clipboard?.writeText(exportPGN(game))
                showToast('棋谱 PGN 已复制到剪贴板')
              }}><Icon name="menu" size={18} /> 分享棋谱</button>
              <button onClick={() => {
                setMenuOpen(false)
                void exportGameImage(game, { plyIndex: currentPlyIndex, mode: 'share' })
              }}><Icon name="chart" size={18} /> 分享局面</button>
              <button onClick={() => { setMenuOpen(false); enterSelfAnalysis() }}><Icon name="chart" size={18} /> 自我分析</button>
              <button onClick={() => { setMenuOpen(false); setSheetTab('controls') }}><Icon name="hint" size={18} /> AI 教练</button>
            </div>
          </>
        )}
        {navOpen && (
          <>
            <div className="mpb-pop-backdrop" onClick={() => setNavOpen(false)} />
            <div className="mpb-pop-nav">
              <div className="mpb-nav-row">
                <button className="mpb-btn" onClick={goToStart} title="开局"><Icon name="start" size={18} /></button>
                <input type="range" min={0} max={game.plies.length} value={currentPlyIndex}
                  onChange={(e) => { const s = useStore.getState(); s.goToPly(parseInt(e.target.value)) }} />
                <button className="mpb-btn" onClick={goToEnd} title="末局"><Icon name="end" size={18} /></button>
              </div>
              <div className="mpb-nav-row">
                <span className="mpb-nav-pos">{currentPlyIndex}/{game.plies.length}</span>
                <button className={`mpb-btn ${autoPlay ? 'mpb-playing' : ''}`} onClick={() => setAutoPlay(!autoPlay)}>
                  <Icon name={autoPlay ? 'pause' : 'play'} size={16} /> {autoPlay ? '暂停' : '自动播放'}
                </button>
              </div>
              <div className="mpb-nav-row">
                <span className="mpb-nav-pos">速度</span>
                {([[2000, '慢'], [1000, '中'], [500, '快'], [200, '极快']] as [number, string][]).map(([v, l]) => (
                  <button key={v} className={`filter-btn ${autoPlaySpeed === v ? 'btn-active' : ''}`}
                    onClick={() => updateSettings({ autoPlaySpeed: v })}>{l}</button>
                ))}
              </div>
              <div className="mpb-nav-row">
                <button className="mpb-btn" onClick={() => jumpKey('prev')} title="上一关键手"><Icon name="flag" size={16} /> 上一关键</button>
                <button className="mpb-btn" onClick={() => jumpKey('next')} title="下一关键手"><Icon name="flag" size={16} /> 下一关键</button>
              </div>
            </div>
          </>
        )}
        <div className="mpb-icons">
          <BarButton icon="menu" label="菜单" onClick={() => setMenuOpen(true)} />
          <BarButton icon="nav" label="导航" onClick={() => setNavOpen(true)} />
          <BarButton icon="prev" label="上一步" onClick={goBack} disabled={currentPlyIndex <= 0} />
          <BarButton icon="next" label="下一步" onClick={goForward} disabled={currentPlyIndex >= game.plies.length} primary />
          <BarButton icon="flag" label="关键手" onClick={() => jumpKey('next')} />
          <BarButton icon="chart" label="分析" onClick={enterSelfAnalysis} />
        </div>
      </div>
    )
  }

  // 对战 / 摆棋 / 错题 / 拆解 / 训练等模式：棋盘下常驻核心操作
  const openGame = () => {
    setMoreOpen(false)
    setSheetTab('newgame')
  }

  return (
    <div className="mobile-play-bar mpb-play">
      {moreOpen && (
        <>
          <div className="mpb-pop-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="mpb-pop-menu mpb-more-menu">
            <button onClick={openGame}><Icon name="plus" size={18} /> 新对局</button>
            <button onClick={() => { setMoreOpen(false); flipBoard() }}><Icon name="flip" size={18} /> 翻转棋盘</button>
            <button onClick={() => {
              setMoreOpen(false)
              void navigator.clipboard?.writeText(exportPGN(game))
              showToast('棋谱 PGN 已复制到剪贴板')
            }}><Icon name="list" size={18} /> 复制棋谱</button>
            <button onClick={() => { setMoreOpen(false); setSheetTab('controls') }}><Icon name="gear" size={18} /> 设置</button>
          </div>
        </>
      )}
      <div className="mpb-icons">
        {singleHuman ? (
          <>
            <BarButton icon="undo" label="悔棋" onClick={undo}
              disabled={isThinking || currentPlyIndex < 1 || over}
              title={over ? '对局已结束' : `悔棋（本局剩余 ${Math.max(0, MAX_UNDO_PER_GAME - undoCount)} 次）`} />
            <BarButton icon="hint" label="提示" onClick={() => aiHint()}
              disabled={!engineReady || isThinking || demo} title={isThinking ? '思考中' : '提示'} />
            <BarButton icon="flag" label="认输" onClick={() => setConfirmKind('resign')} disabled={over} />
            <BarButton icon="draw" label="求和" onClick={() => setConfirmKind('draw')} disabled={over} />
          </>
        ) : (
          <>
            <BarButton icon="undo" label="悔棋" onClick={undo}
              disabled={isThinking || currentPlyIndex < 1 || over || demo}
              title={demo ? '演示模式不可悔棋' : `悔棋（本局剩余 ${Math.max(0, MAX_UNDO_PER_GAME - undoCount)} 次）`} />
            <BarButton icon="hint" label="提示" onClick={() => aiHint()}
              disabled={!engineReady || isThinking || demo} />
            <BarButton icon="flip" label="翻转" onClick={flipBoard} />
            <BarButton icon="plus" label="新对局" onClick={() => setSheetTab('newgame')} />
          </>
        )}
        <BarButton icon="more" label="更多" onClick={() => setMoreOpen(true)} />
      </div>
      {/* 认输/求和：统一底部确认条（替代原生 confirm） */}
      {confirmKind && (
        <div className="mpb-confirm-backdrop" onClick={() => setConfirmKind(null)}>
          <div className="mpb-confirm" onClick={e => e.stopPropagation()}>
            <div className="mpb-confirm-title">{confirmKind === 'resign' ? '确定认输？' : '请求和棋？'}</div>
            <div className="mpb-confirm-desc">
              {confirmKind === 'resign' ? '本局将判负并保存战绩。' : '对方将根据当前形势决定是否接受。'}
            </div>
            <div className="mpb-confirm-actions">
              <button className="mpb-btn" onClick={() => setConfirmKind(null)}>取消</button>
              <button className="mpb-btn mpb-main" onClick={() => {
                const kind = confirmKind
                setConfirmKind(null)
                if (kind === 'resign') resign()
                else offerDraw()
              }}>{confirmKind === 'resign' ? '认输' : '求和'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
