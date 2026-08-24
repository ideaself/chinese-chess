/**
 * 主应用组件
 *
 * 计划第2节: V1 产品结构
 *   对战 | 棋谱 | 分析 | 设置
 */

import React, { useEffect, useState } from 'react'
import { useStore, DIFFICULTY_LABELS } from './store/useStore'
import type { Difficulty } from './store/useStore'
import { Board } from './components/Board/Board'
import { Controls } from './components/Controls/Controls'
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
import type { AppSettings } from './game/storage'
import { getRank } from './game/rating'
import { resumeAudio } from './game/sound'
import { fetchModels } from './game/coach/aiCoach'
import { APP_VERSION } from './version'
import { BOARD_SKINS, PIECE_SKINS } from './skins'
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
        if (e.key === 'ArrowLeft') { s.variationGo(s.variation.index - 1); e.preventDefault() }
        else if (e.key === 'ArrowRight') { s.variationGo(s.variation.index + 1); e.preventDefault() }
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

  return (
    <div className="app">
      {updateReady && (
        <div className="update-banner">
          <span>🎉 新版本已就绪，刷新后生效</span>
          <button className="btn btn-sm btn-primary" onClick={() => location.reload()}>立即刷新</button>
          <button className="btn btn-sm" onClick={() => setUpdateReady(false)}>✕</button>
        </div>
      )}
      {/* 顶部导航 */}
      <header className="app-header">
        <h1 className="app-title">♟ 中国象棋</h1>
        <nav className="tab-nav">
          {([['play', '对战'], ['games', '棋谱'], ['analysis', '分析'], ['settings', '设置']] as [Tab, string][]).map(([t, label]) => (
            <button key={t} className={`tab-btn ${activeTab === t ? 'tab-active' : ''}`}
              onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* 状态栏 */}
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

      {/* 主内容区 */}
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
            <span>将军音效</span>
            <input type="checkbox" checked={settings.soundCheck}
              onChange={e => { resumeAudio(); update({ soundCheck: e.target.checked }) }} />
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


