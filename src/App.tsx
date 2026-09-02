/**
 * 主应用组件
 *
 * 计划第2节: V1 产品结构
 *   对战 | 棋谱 | 分析 | 设置
 */

import React, { useEffect, useRef, useState } from 'react'
import { useStore, DIFFICULTY_LABELS } from './store/useStore'
import type { Difficulty } from './store/useStore'
import { Board } from './components/Board/Board'
import { Controls } from './components/Controls/Controls'
import { NewGamePanel } from './components/Controls/NewGamePanel'
import { AnalysisPanel } from './components/Analysis/AnalysisPanel'
import { SetupPanel } from './components/Analysis/SetupPanel'
import { PuzzlePanel } from './components/Analysis/PuzzlePanel'
import { VariationPanel } from './components/Analysis/VariationPanel'
import { OpeningTrainingPanel } from './components/Games/OpeningTrainingPanel'
import { MasterQuizPanel } from './components/Games/MasterQuizPanel'
import { GamesPanel } from './components/Games/GamesPanel'
import { StatsPanel } from './components/Stats/StatsPanel'
import { isInCheck } from './game/rules'
import { getSettings } from './game/storage'
import { uploadBackup, downloadBackup, getLastSync, diagnoseConnection } from './game/webdav'
import type { DiagStep } from './game/webdav'
import type { AppSettings } from './game/storage'
import { getRank } from './game/rating'
import { resumeAudio } from './game/sound'
import { fetchModels } from './game/coach/aiCoach'
import { APP_VERSION } from './version'
import { BOARD_SKINS, PIECE_SKINS } from './skins'
import { useMediaQuery, MOBILE_QUERY } from './utils/useMediaQuery'
import { MobilePlayBar } from './components/Controls/MobilePlayBar'
import { MobileHome } from './components/Controls/MobileHome'
import { ReplayTabs } from './components/Analysis/ReplayTabs'
import { SelfAnalysisBanner } from './components/Analysis/SelfAnalysisBanner'
import { BOARD_HOME } from './store/constants'
import { initBackNav, syncLayers } from './game/backNav'
import { Capacitor } from '@capacitor/core'
import './App.css'

type Tab = 'play' | 'games' | 'analysis' | 'settings'

export const App: React.FC = () => {
  const init = useStore(s => s.init)
  const board = useStore(s => s.board)
  const game = useStore(s => s.game)
  const mode = useStore(s => s.mode)
  const lastMove = useStore(s => s.lastMove)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const boardFlipped = useStore(s => s.boardFlipped)
  const activeTab = useStore(s => s.activeTab)
  const setTab = useStore(s => s.setTab)
  const redTime = useStore(s => s.redTime)
  const blackTime = useStore(s => s.blackTime)
  const setDifficulty = useStore(s => s.setDifficulty)
  const toast = useStore(s => s.toast)
  const variation = useStore(s => s.variation)
  const openingTraining = useStore(s => s.openingTraining)
  const masterQuiz = useStore(s => s.masterQuiz)
  const theme = useStore(s => s.settings.theme)
  const sheetTab = useStore(s => s.sheetTab)
  const setSheetTab = useStore(s => s.setSheetTab)
  const selfAnalysis = useStore(s => s.selfAnalysis)
  const mobilePage = useStore(s => s.mobilePage)
  const setMobilePage = useStore(s => s.setMobilePage)
  const isMobile = useMediaQuery(MOBILE_QUERY)

  useEffect(() => {
    init()
    // 应用默认难度设置（计划第20节）
    const settings = getSettings()
    if (settings.defaultDifficulty) {
      setDifficulty(settings.defaultDifficulty as Difficulty)
    }
  }, [init, setDifficulty])

  // 主题应用（深色/浅色）
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f1eee7' : '#16162a')
  }, [theme])

  // 键盘快捷键: 重放导航 / 推演步进（←→ 空格 Home End）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

       const s = useStore.getState()

       if (s.variation) {
         if (e.key === 'ArrowLeft') { s.variationGo(s.variation.currentPly - 1); e.preventDefault() }
         else if (e.key === 'ArrowRight') { s.variationGo(s.variation.currentPly + 1); e.preventDefault() }
         return
       }

      if (s.mode === 'replay') {
        switch (e.key) {
          case 'ArrowLeft': s.goBack(); e.preventDefault(); break
          case 'ArrowRight': s.goForward(); e.preventDefault(); break
          case 'Home': s.goToStart(); e.preventDefault(); break
          case 'End': s.goToEnd(); e.preventDefault(); break
          case ' ': s.setAutoPlaying(!s.autoPlaying); e.preventDefault(); break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const inCheck = isInCheck(board)

  // PWA 新版本提示：Service Worker 接管页面时收到事件（见 main.tsx）
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => {
    const onUpdate = () => setUpdateReady(true)
    window.addEventListener('xiangqi-update-ready', onUpdate)
    return () => window.removeEventListener('xiangqi-update-ready', onUpdate)
  }, [])

  // 移动端覆盖层 key：显式 sheetTab 优先；特殊模式自动弹出对应面板；__board__ 表示用户主动回到纯棋盘
  const specialSheet: string | null = mode === 'setup' ? 'setup'
    : mode === 'puzzle' ? 'puzzle'
    : masterQuiz ? 'quiz'
    : openingTraining ? 'opening'
    : null
  const mobileSheet = sheetTab === BOARD_HOME ? null : (sheetTab ?? specialSheet)

  // ── 层级导航：安卓返回手势/按键、浏览器右滑、页头「←」统一走 navigateBack ──
  useEffect(() => {
    initBackNav(() => useStore.getState().navigateBack())
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app').then(({ App }) => {
        void App.addListener('backButton', () => useStore.getState().navigateBack())
      }).catch(() => {})
    }
  }, [])

  // 顶层覆盖层数（推演 / 特殊模式 / 面板，specialSheet 已并入 mobileSheet）变化时同步历史占位
  const layerCount = (variation ? 1 : 0) + (mobileSheet ? 1 : 0)
  useEffect(() => { syncLayers(layerCount) }, [layerCount])

  // 推演收尾守卫：
  // 1) 自我分析中推演被面板内「退出推演」等路径终止 → 复位标志、清箭头残留
  // 2) variation 已不存在但分支面板覆盖层仍开着 → 关闭（曾致空白页）
  useEffect(() => {
    if (selfAnalysis && !variation) {
      useStore.setState({ selfAnalysis: false, hintInfo: null })
    }
    if (sheetTab === 'variation' && !useStore.getState().variation) {
      setSheetTab(BOARD_HOME)
    }
  }, [selfAnalysis, variation, sheetTab, setSheetTab])

  const renderPanelContent = (key: string | null) => {
    switch (key) {
      case 'controls': return <Controls />
      case 'games': return <GamesPanel />
      case 'analysis': return <AnalysisPanel />
      case 'settings': return <><StatsPanel /><SettingsPanel /></>
      case 'setup': return <SetupPanel />
      case 'puzzle': return <PuzzlePanel />
      case 'variation': return <VariationPanel />
      case 'quiz': return <MasterQuizPanel />
      case 'opening': return <OpeningTrainingPanel />
      case 'newgame': return <NewGamePanel />
      default: return null
    }
  }

  const SHEET_TITLES: Record<string, string> = {
    controls: '对局设置', games: '棋谱库', analysis: '局面分析', settings: '设置',
    setup: '摆棋', puzzle: '错题练习', variation: '分支推演', quiz: '名局拆解', opening: '开局训练',
    newgame: '新对局',
  }

  // 复盘页标题（仿天天象棋）：「红名 先负 黑名（12/184）」，超宽时滚动显示
  const titleRef = useRef<HTMLSpanElement>(null)
  const [titleScroll, setTitleScroll] = useState<{ dist: number; dur: number } | null>(null)
  const replayTitle = mode === 'replay'
    ? `${game.header.Red || '玩家'} ${game.result === '1-0' ? '先胜' : game.result === '0-1' ? '先负' : game.result === '1/2-1/2' ? '和棋' : '对局中'} ${game.header.Black || '玩家'}(${currentPlyIndex}/${game.plies.length})`
    : ''
  useEffect(() => {
    if (mode !== 'replay' || !isMobile) { setTitleScroll(null); return }
    const measure = () => {
      const el = titleRef.current
      const inner = el?.firstChild as HTMLElement | null
      if (!el || !inner) return
      const overflow = inner.scrollWidth - el.clientWidth
      setTitleScroll(overflow > 4 ? { dist: overflow, dur: Math.max(6, overflow / 16) } : null)
    }
    measure()
    const t = setTimeout(measure, 350) // 字体/布局稳定后复测
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [replayTitle, mode, isMobile])
  const fmtTime = (ms: number) => {
    const t = Math.floor(ms / 1000)
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  }
  // 退出复盘 → 回到可下棋的对战棋盘（复盘已替换对局内容，重开一局）
  const exitReplay = () => {
    const s = useStore.getState()
    s.restart()
    s.setTab('play')
    s.setSheetTab(BOARD_HOME)
    // 移动端：从棋谱页进的复盘 → 回棋谱列表；其他 → 回对战页
    if (isMobile) {
      const backTo = s.mobilePage === 'games' ? 'games' : 'play'
      s.setMobilePage(backTo)
    }
  }

  return (
    <div className="app">
      {updateReady && (
        <div className="update-banner">
          <span>🎉 新版本已就绪，刷新后生效</span>
          <button className="btn btn-sm btn-primary" onClick={() => location.reload()}>立即刷新</button>
          <button className="btn btn-sm" onClick={() => setUpdateReady(false)}>✕</button>
        </div>
      )}
      {/* 顶部导航（移动端仅标题，Tab 移至底部） */}
      <header className="app-header">
        {isMobile && mode === 'replay' && !variation ? (
          <div className="replay-header">
            <span className="replay-title" ref={titleRef}>
              <span className={`replay-title-inner ${titleScroll ? 'scrolling' : ''}`}
                style={titleScroll ? ({ '--marquee-dist': `${titleScroll.dist}px`, '--marquee-dur': `${titleScroll.dur}s` } as React.CSSProperties) : undefined}>
                {replayTitle}
              </span>
            </span>
            <span className="replay-players">黑 {fmtTime(blackTime)} vs 红 {fmtTime(redTime)}</span>
          </div>
        ) : (
          <h1 className="app-title">♟ 中国象棋</h1>
        )}
        {!isMobile && (
          <nav className="tab-nav">
            {([['play', '对战'], ['games', '棋谱'], ['analysis', '分析'], ['settings', '设置']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} className={`tab-btn ${activeTab === t ? 'tab-active' : ''}`}
                onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {/* 状态栏（移动端复盘隐藏：步数与胜负已在标题和局势图中，给棋盘腾空间） */}
      {!(isMobile && mode === 'replay' && !variation) && (
        <div className="status-bar">
          <span className={`turn-indicator ${board.turn === 'w' ? 'turn-red' : 'turn-black'}`}>
            {variation
              ? '主变推演'
              : mode === 'setup'
                ? '摆棋模式'
                : mode === 'puzzle'
                  ? '错误重走'
                  : openingTraining
                    ? '开局训练'
                    : mode === 'replay'
                      ? `第 ${currentPlyIndex}/${game.plies.length} 步`
                      : board.turn === 'w' ? '红方走棋' : '黑方走棋'}
          </span>
          {inCheck && <span className="check-badge">将军!</span>}
          {game.result !== '*' && (
            <span className="game-over-badge">
              {game.result === '1-0' ? '红胜' : game.result === '0-1' ? '黑胜' : '和棋'}
            </span>
          )}
        </div>
      )}

      {/* 对局结束结果面板 */}
      {game.result !== '*' && mode === 'play' && (
        <GameOverModal
          result={game.result}
          plies={game.plies.length}
          redTime={redTime}
          blackTime={blackTime}
        />
      )}

      {/* 全局轻提示 */}
      {toast && <div className="toast">{toast}</div>}

      {isMobile ? (
        <>
          {/* ── 移动端：多层导航（首页 → 对战/棋谱/设置）── */}

          {/* 首页：三个大按钮 */}
          {mobilePage === 'home' && <MobileHome />}

          {/* 对战页：棋盘 + 操控栏（保持现有布局） */}
          {mobilePage === 'play' && (
            <>
              <main className="app-main">
                {variation && selfAnalysis && <SelfAnalysisBanner />}
                <div className="board-area">
                  <Board />
                </div>
                {mode === 'replay' && !variation && <ReplayTabs />}
              </main>

              {!mobileSheet && <MobilePlayBar />}

              {mobileSheet && (
                <div className="mobile-overlay">
                  <div className="mobile-overlay-header">
                    <button className="mobile-overlay-back" aria-label="返回"
                      onClick={() => useStore.getState().navigateBack()}>←</button>
                    <span>{SHEET_TITLES[mobileSheet] ?? '面板'}</span>
                    <button className="mobile-overlay-close" aria-label="关闭"
                      onClick={() => setSheetTab(BOARD_HOME)}>✕</button>
                  </div>
                  <div className="mobile-overlay-body">
                    {renderPanelContent(mobileSheet)}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 棋谱页：全屏列表/大师库/错题本/训练 */}
          {mobilePage === 'games' && (
            <div className="mobile-page">
              <div className="mobile-page-header">
                <button className="mobile-page-back" onClick={() => setMobilePage('home')}>←</button>
                <span className="mobile-page-title">棋谱</span>
              </div>
              <div className="mobile-page-body">
                <GamesPanel />
              </div>
            </div>
          )}

          {/* 设置页：全屏设置面板 */}
          {mobilePage === 'settings' && (
            <div className="mobile-page">
              <div className="mobile-page-header">
                <button className="mobile-page-back" onClick={() => setMobilePage('home')}>←</button>
                <span className="mobile-page-title">设置</span>
              </div>
              <div className="mobile-page-body">
                <StatsPanel />
                <SettingsPanel />
              </div>
            </div>
          )}
        </>
      ) : (
        /* 桌面端：棋盘常驻 + 右侧栏（保持现状） */
        <main className="app-main">
          <div className="board-area">
            <Board />
          </div>

          <div className="side-panel">
            {mode === 'setup' ? (
              <SetupPanel />
            ) : mode === 'puzzle' ? (
              <PuzzlePanel />
            ) : variation ? (
              <VariationPanel />
            ) : activeTab === 'play' && openingTraining ? (
              <OpeningTrainingPanel />
            ) : activeTab === 'play' && masterQuiz ? (
              <MasterQuizPanel />
            ) : (
              <>
                {activeTab === 'play' && <Controls />}
                {activeTab === 'games' && <GamesPanel />}
                {activeTab === 'analysis' && <AnalysisPanel />}
                {activeTab === 'settings' && (
                  <>
                    <StatsPanel />
                    <SettingsPanel />
                  </>
                )}
              </>
            )}
          </div>
        </main>
      )}
    </div>
  )
}

/** 对局结束结果面板 */
const GameOverModal: React.FC<{
  result: string
  plies: number
  redTime: number
  blackTime: number
}> = ({ result, plies, redTime, blackTime }) => {
  const restart = useStore(s => s.restart)
  const loadGame = useStore(s => s.loadGame)
  const game = useStore(s => s.game)
  const setTab = useStore(s => s.setTab)
  const analyzeCurrentGame = useStore(s => s.analyzeCurrentGame)
  const lastRatingChange = useStore(s => s.lastRatingChange)
  const rank = useStore(s => (s.lastRatingChange ? getRank(s.lastRatingChange.after).tier.name : null))

  const handleReview = () => {
    loadGame(game.id)
    analyzeCurrentGame()
    setTab('analysis')
  }

  return (
    <div className="game-over-modal">
      <div className="game-over-content">
        <h2 className="game-over-title">
          {result === '1-0' ? '红方胜!' : result === '0-1' ? '黑方胜!' : '和棋!'}
        </h2>
        {lastRatingChange && (
          <div className="rating-change-line">
            棋力分 <strong>{lastRatingChange.before} → {lastRatingChange.after}</strong>
            <span className={lastRatingChange.delta > 0 ? 'delta-up' : lastRatingChange.delta < 0 ? 'delta-down' : ''}>
              {' '}({lastRatingChange.delta > 0 ? '+' : ''}{lastRatingChange.delta})
            </span>
            {rank && <span className="rank-inline"> · {rank}</span>}
          </div>
        )}
        <div className="game-over-stats">
          <div className="stat-item">
            <span className="stat-label">回合数</span>
            <span className="stat-value">{Math.ceil(plies / 2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">红方用时</span>
            <span className="stat-value">{formatTime(redTime)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">黑方用时</span>
            <span className="stat-value">{formatTime(blackTime)}</span>
          </div>
        </div>
        <div className="game-over-actions">
          <button className="btn btn-primary" onClick={restart}>再来一局</button>
          <button className="btn btn-secondary" onClick={handleReview}>复盘本局</button>
          <button className="btn btn-secondary" onClick={() => { loadGame(game.id); setTab('games') }}>查看棋谱</button>
        </div>
      </div>
    </div>
  )
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/** 设置面板 */

const FALLBACK_MODELS = ['deepseek-chat', 'deepseek-reasoner']

const SettingsPanel: React.FC = () => {
  // 响应式设置：修改即时生效（皮肤/主题/音效等）
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const flipBoard = useStore(s => s.flipBoard)
  const boardFlipped = useStore(s => s.boardFlipped)

  // AI 模型列表自动获取（防抖，Key/地址变化后 600ms 触发）
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS)
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const apiKey = settings.aiCoachApiKey || ''
  const baseUrl = settings.aiCoachBaseUrl || '/ai-proxy'

  useEffect(() => {
    if (!apiKey.trim()) { setModels(FALLBACK_MODELS); setModelStatus('idle'); return }
    setModelStatus('loading')
    const timer = setTimeout(() => {
      fetchModels()
        .then(list => {
          // 兼容手动填过列表外的模型名
          const merged = [...new Set([...list, ...(settings.aiCoachModel && !list.includes(settings.aiCoachModel) ? [settings.aiCoachModel] : [])])]
          setModels(merged)
          setModelStatus('idle')
        })
        .catch(() => setModelStatus('error'))
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, baseUrl])

  const update = (patch: Partial<AppSettings>) => {
    updateSettings(patch)
    if (patch.boardFlipped !== undefined && patch.boardFlipped !== boardFlipped) {
      flipBoard()
    }
  }

  return (
    <div className="settings-panel">
      <div className="panel-header"><h3>设置</h3></div>
      <div className="panel-body">
        <div className="settings-group">
          <h4>外观</h4>
          <div className="settings-row">
            <span>主题</span>
            <select className="settings-select" value={settings.theme}
              onChange={e => update({ theme: e.target.value as AppSettings['theme'] })}>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </div>
        </div>
        <div className="settings-group">
          <h4>棋盘</h4>
          <div className="settings-row">
            <span>棋盘样式</span>
            <select className="settings-select" value={settings.boardStyle}
              onChange={e => update({ boardStyle: e.target.value })}>
              <option value="classic">经典（SVG）</option>
              {BOARD_SKINS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <span>棋子样式</span>
            <select className="settings-select" value={settings.pieceStyle}
              onChange={e => update({ pieceStyle: e.target.value })}>
              <option value="classic">经典（SVG）</option>
              {PIECE_SKINS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <span>翻转棋盘</span>
            <input type="checkbox" checked={settings.boardFlipped}
              onChange={e => update({ boardFlipped: e.target.checked })} />
          </div>
        </div>
        <div className="settings-group">
          <h4>操作</h4>
          <div className="settings-row">
            <span>显示合法走法</span>
            <input type="checkbox" checked={settings.showLegalMoves}
              onChange={e => update({ showLegalMoves: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>落子动画</span>
            <input type="checkbox" checked={settings.animationEnabled}
              onChange={e => update({ animationEnabled: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>自动局面评估</span>
            <input type="checkbox" checked={settings.autoEval !== false}
              onChange={e => update({ autoEval: e.target.checked })} />
          </div>
        </div>
        <div className="settings-group">
          <h4>音效</h4>
          <div className="settings-row">
            <span>落子音效</span>
            <input type="checkbox" checked={settings.soundMove}
              onChange={e => { resumeAudio(); update({ soundMove: e.target.checked }) }} />
          </div>
          <div className="settings-row">
            <span>吃子音效</span>
            <input type="checkbox" checked={settings.soundCapture}
              onChange={e => { resumeAudio(); update({ soundCapture: e.target.checked }) }} />
          </div>
          <div className="settings-row">
            <span>吃子语音「吃」</span>
            <input type="checkbox" checked={settings.soundCaptureVoice}
              onChange={e => { resumeAudio(); update({ soundCaptureVoice: e.target.checked }) }} />
          </div>
          <div className="settings-row">
            <span>复盘走子音效</span>
            <input type="checkbox" checked={settings.soundReplay}
              onChange={e => { resumeAudio(); update({ soundReplay: e.target.checked }) }} />
          </div>
          <div className="settings-row">
            <span>将军音效</span>
            <input type="checkbox" checked={settings.soundCheck}
              onChange={e => { resumeAudio(); update({ soundCheck: e.target.checked }) }} />
          </div>
          <div className="settings-row">
            <span>将军语音「将军」</span>
            <input type="checkbox" checked={settings.soundCheckVoice}
              onChange={e => { resumeAudio(); update({ soundCheckVoice: e.target.checked }) }} />
          </div>
        </div>
        <div className="settings-group">
          <h4>对局</h4>
          <div className="settings-row">
            <span>默认执棋</span>
            <select className="settings-select" value={settings.defaultSide}
              onChange={e => update({ defaultSide: e.target.value as AppSettings['defaultSide'] })}>
              <option value="w">红方（先行）</option>
              <option value="b">黑方</option>
              <option value="random">随机</option>
            </select>
          </div>
          <div className="settings-row">
            <span>默认 AI 难度</span>
            <select className="settings-select" value={settings.defaultDifficulty}
              onChange={e => update({ defaultDifficulty: e.target.value })}>
              {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map(d => (
                <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span>自动播放速度</span>
            <select className="settings-select" value={settings.autoPlaySpeed}
              onChange={e => update({ autoPlaySpeed: Number(e.target.value) })}>
              <option value={2000}>慢</option>
              <option value={1000}>中</option>
              <option value={500}>快</option>
              <option value={200}>极快</option>
            </select>
          </div>
        </div>
        <div className="settings-group">
          <h4>AI 教练</h4>
          <div className="settings-row">
            <span>API Key</span>
            <input
              type="password"
              className="settings-select"
              style={{ maxWidth: 180 }}
              placeholder="sk-...（DeepSeek）"
              value={settings.aiCoachApiKey || ''}
              onChange={e => update({ aiCoachApiKey: e.target.value })}
            />
          </div>
          <div className="settings-row">
            <span>模型</span>
            <select className="settings-select" value={settings.aiCoachModel || 'deepseek-chat'}
              onChange={e => update({ aiCoachModel: e.target.value })}
              disabled={!apiKey.trim()}>
              {modelStatus === 'loading' && <option value={settings.aiCoachModel || 'deepseek-chat'}>
                {settings.aiCoachModel || 'deepseek-chat'}（获取列表中…）
              </option>}
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {!apiKey.trim()
              ? '填入 API Key 后自动获取可用模型列表'
              : modelStatus === 'loading'
                ? '正在获取模型列表…'
                : modelStatus === 'error'
                  ? '⚠ 模型列表获取失败，显示默认模型；可检查 Key 或接口地址后重试（修改任一项自动重试）'
                  : `已从接口获取 ${models.length} 个可用模型`}
          </div>
          <div className="settings-row">
            <span>接口地址</span>
            <input
              type="text"
              className="settings-select"
              style={{ maxWidth: 180 }}
              placeholder="/ai-proxy 或 https://api.deepseek.com"
              value={settings.aiCoachBaseUrl || '/ai-proxy'}
              onChange={e => update({ aiCoachBaseUrl: e.target.value })}
            />
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            填入 Key 后，复盘教练面板可向 AI 教练提问。开发模式默认经本地代理转发到 api.deepseek.com；
            生产/移动端可改为直连地址或自建网关。
          </div>
        </div>
        <CloudSyncSection settings={settings} update={update} />
        <div className="settings-group">
          <h4>关于</h4>
          <div className="settings-row">
            <span>版本</span>
            <span style={{ color: '#888' }}>v{APP_VERSION}</span>
          </div>
          <div className="settings-row">
            <span>AI 引擎</span>
            <span style={{ color: '#888' }}>Pikafish WASM</span>
          </div>
        </div>
      </div>
    </div>
  )
}


/** 云同步（WebDAV）：凭据配置 + 上传/下载全量备份 */
const CloudSyncSection: React.FC<{
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
}> = ({ settings, update }) => {
  const showToast = useStore(s => s.showToast)
  const refreshSavedGames = useStore(s => s.refreshSavedGames)
  const [busy, setBusy] = useState<'upload' | 'download' | null>(null)
  const [diag, setDiag] = useState<DiagStep[] | null>(null)
  const [diagWorkingPath, setDiagWorkingPath] = useState<string | undefined>(undefined)
  const [diagBusy, setDiagBusy] = useState(false)
  const cred: { url: string; user: string; password: string } = {
    url: settings.webdavUrl || '',
    user: settings.webdavUser || '',
    password: settings.webdavPassword || '',
  }
  const configured = !!(cred.url && cred.user && cred.password)
  const lastSync = getLastSync()

  const run = async (kind: 'upload' | 'download') => {
    if (!configured) { showToast('请先填写 WebDAV 地址 / 账号 / 密码'); return }
    setBusy(kind)
    const result = kind === 'upload' ? await uploadBackup(cred) : await downloadBackup(cred)
    setBusy(null)
    if (result.ok) {
      refreshSavedGames()
      showToast('☁ ' + result.message)
    } else {
      showToast('⚠ ' + result.message)
    }
  }

  const runDiag = async () => {
    if (!configured) { showToast('请先填写 WebDAV 地址 / 账号 / 密码'); return }
    setDiagBusy(true)
    setDiag(null)
    const r = await diagnoseConnection(cred)
    setDiag(r.steps)
    setDiagWorkingPath(r.workingPath)
    setDiagBusy(false)
  }

  return (
    <div className="settings-group">
      <h4>云同步（WebDAV）</h4>
      <div className="settings-row">
        <span>地址</span>
        <input
          type="text"
          className="settings-select"
          style={{ maxWidth: 180 }}
          placeholder="https://dav.jianguoyun.com/dav/xiangqi"
          value={cred.url}
          onChange={e => update({ webdavUrl: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span>账号</span>
        <input
          type="text"
          className="settings-select"
          style={{ maxWidth: 180 }}
          placeholder="WebDAV 账号"
          value={cred.user}
          onChange={e => update({ webdavUser: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span>密码</span>
        <input
          type="password"
          className="settings-select"
          style={{ maxWidth: 180 }}
          placeholder="密码 / 应用密码"
          value={cred.password}
          onChange={e => update({ webdavPassword: e.target.value })}
        />
      </div>
      <div className="settings-row" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-primary" disabled={!configured || busy !== null}
          onClick={() => void run('upload')}>
          {busy === 'upload' ? '⏳ 上传中…' : '☁ 备份到云端'}
        </button>
        <button className="btn btn-sm" disabled={!configured || busy !== null}
          onClick={() => void run('download')}>
          {busy === 'download' ? '⏳ 恢复中…' : '⬇ 从云端恢复'}
        </button>
        <button className="btn btn-sm" disabled={!configured || diagBusy}
          title="探测服务器与可写目录位置"
          onClick={() => void runDiag()}>
          {diagBusy ? '⏳ 诊断中…' : '🔍 连接诊断'}
        </button>
        <span style={{ fontSize: 12, color: '#888' }}>
          {lastSync ? `上次同步 ${new Date(lastSync).toLocaleString()}` : '未同步过'}
        </span>
      </div>

      {/* 诊断结果 */}
      {diag && (
        <div style={{ fontSize: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}>
          {diag.map((d, i) => (
            <div key={i} style={{ padding: '2px 0' }}>
              {d.ok ? '✓' : '✗'} {d.name} — <span style={{ color: d.ok ? '#888' : '#e67e22' }}>{d.detail}</span>
            </div>
          ))}
          {diagWorkingPath && diagWorkingPath !== (settings.webdavUrl || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') && (
            <button className="btn btn-sm btn-primary" style={{ marginTop: 4 }}
              onClick={() => {
                const origin = cred.url.replace(/^https?:\/\/[^/]+/, m => m)
                update({ webdavUrl: cred.url.slice(0, cred.url.length - origin.length) + diagWorkingPath })
                setDiag(null)
                showToast(`已改用 ${diagWorkingPath}`)
              }}>
              采用 {diagWorkingPath}
            </button>
          )}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
        全量备份（棋谱/设置/战绩/错题本/棋力分）上传为 xiangqi-backup.json；
        恢复为合并语义，不覆盖本机已有数据。坚果云等支持 WebDAV 的网盘均可，
        推荐使用应用密码。凭据仅保存在本机。
      </div>
    </div>
  )
}
