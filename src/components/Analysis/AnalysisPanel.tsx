/**
 * 分析面板 - 完整版
 *
 * 计划第9-13节:
 *   - 引擎评估
 *   - 最佳走法
 *   - 每步评价
 *   - 关键时刻
 *   - 优势曲线
 */

import React, { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { getStateAtPly } from '../../game/model'
import { boardToFen } from '../../game/board'
import { chineseFromFen, pvToChinese } from '../../game/rules'
import { generateGameSummary } from '../../game/summary'
import { getSettings, saveSettings } from '../../game/storage'
import { acquireEngineSlot, releaseEngineSlot } from '../../game/masterPreanalysis'
import { EvalCurve } from './EvalCurve'
import { KeyMoments } from './KeyMoments'
import { SimilarPanel } from './SimilarPanel'

function formatScore(score: number): string {
  if (score >= 100000) return `胜势 (${score - 100000}步杀)`
  if (score <= -100000) return `败势 (${-score - 100000}步被杀)`
  const pawns = (score / 100).toFixed(1)
  return score >= 0 ? `红优 +${pawns}` : `黑优 ${pawns}`
}

/** 每步着法评级徽标（复用整盘分析的分类结果，爱棋谱式好/恶手标注） */
const MOVE_TAGS: Record<string, { t: string; c: string }> = {
  best: { t: '正', c: 'mt-best' },
  excellent: { t: '妙', c: 'mt-excellent' },
  good: { t: '好', c: 'mt-good' },
  inaccuracy: { t: '软', c: 'mt-inaccuracy' },
  mistake: { t: '次', c: 'mt-mistake' },
  blunder: { t: '劣', c: 'mt-blunder' },
  blunder2: { t: '漏', c: 'mt-blunder2' },
}
function moveTag(cls?: string): { t: string; c: string } | null {
  if (!cls) return null
  return MOVE_TAGS[cls] ?? null
}

export const AnalysisPanel: React.FC = () => {
  const analysis = useStore(s => s.analysis)
  const game = useStore(s => s.game)
  const engineReady = useStore(s => s.engineReady)
  const isThinking = useStore(s => s.isThinking)
  const analyzePosition = useStore(s => s.analyzePosition)
  const analyzeCurrentGame = useStore(s => s.analyzeCurrentGame)
  const enterSetup = useStore(s => s.enterSetup)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const analysisProgress = useStore(s => s.analysisProgress)
  const cancelAnalysis = useStore(s => s.cancelAnalysis)
  const enterVariationFromLive = useStore(s => s.enterVariationFromLive)
  const startMasterQuiz = useStore(s => s.startMasterQuiz)
  const engine = useStore(s => s.engine)
  const mode = useStore(s => s.mode)

  // 拆棋·多候选着法（计划第16节：引擎 top-N 着法带评分）
  const [cands, setCands] = useState<{ uci: string; cn: string; score: number }[] | null>(null)
  const [candLoading, setCandLoading] = useState(false)

  // 切换局面时清空候选
  React.useEffect(() => { setCands(null) }, [currentPlyIndex])

  const requestCandidates = async () => {
    if (!engine || !engineReady || isThinking) return
    await acquireEngineSlot(() => useStore.getState().isThinking)
    try {
      setCandLoading(true); setCands(null)
      const lines = await engine.analyzeLines(currentFen, [], settings.analysisDepth, 3)
      setCands(lines
        .filter(l => l.move && l.move.length >= 4)
        .map(l => ({ uci: l.move, cn: chineseFromFen(currentFen, l.move), score: l.score })))
    } finally {
      setCandLoading(false); releaseEngineSlot()
    }
  }

  // 点选候选着法 → 在棋盘上试走（并入分支推演）
  const playCandidate = (uci: string) => {
    const s = useStore.getState()
    if (!s.variation && s.mode === 'replay') s.enterVariationFromLive()
    const from = { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) }
    const to = { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) }
    s.selectPiece(from)
    s.tryMove(from, to)
    s.setSheetTab('variation')
  }

  // 分析深度档位（计划9.1）
  const [settings, setSettingsState] = useState(() => getSettings())
  const setAnalysisDepth = (d: number) => {
    const next = { ...settings, analysisDepth: d }
    setSettingsState(next)
    saveSettings(next)
  }

  const currentFen = currentPlyIndex === 0
    ? game.startFen
    : boardToFen(getStateAtPly(game.startFen, game.plies, currentPlyIndex))

  // 本局总结（整盘分析完成后生成，计划第18节）
  const summary = useMemo(
    () => (game.analysisStatus === 'complete' ? generateGameSummary(game) : null),
    [game],
  )

  // PV 主变中文记谱
  const pvCn = useMemo(
    () => (analysis && analysis.bestMove ? pvToChinese(analysis.fen, [analysis.bestMove, ...analysis.pv]) : []),
    [analysis],
  )

  return (
    <div className="analysis-panel">
      <div className="panel-header">
        <h3>分析</h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-sm" onClick={() => analyzePosition()} disabled={!engineReady || isThinking}>
            单局面分析
          </button>
          <button className="btn btn-sm" onClick={() => analyzeCurrentGame()} disabled={!engineReady || isThinking || game.plies.length === 0}>
            整盘分析
          </button>
          <button className="btn btn-sm" onClick={() => enterSetup()} disabled={isThinking}>
            摆棋
          </button>
          <button className="btn btn-sm" onClick={() => startMasterQuiz(game.id)}
            disabled={isThinking || game.plies.length < 40}
            title="从当前棋谱选择关键手进行名局拆解">
            名局拆解
          </button>
        </div>
      </div>

      {/* 分析深度档位（计划9.1） */}
      <div className="depth-row">
        <span className="label">分析深度</span>
        {([[8, '快速'], [12, '标准'], [16, '深度']] as [number, string][]).map(([d, label]) => (
          <button
            key={d}
            className={`filter-btn ${settings.analysisDepth === d ? 'btn-active' : ''}`}
            onClick={() => setAnalysisDepth(d)}
          >{label}</button>
        ))}
        <span className="depth-hint">影响整盘分析速度</span>
      </div>

      <div className="panel-body">
        {/* 整盘分析进度（计划 V1.5 体验项） */}
        {analysisProgress && (
          <div className="analysis-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${Math.round((analysisProgress.current / analysisProgress.total) * 100)}%` }}
              />
            </div>
            <div className="progress-meta">
              <span>正在分析 {analysisProgress.current}/{analysisProgress.total} 个局面</span>
              <button className="btn btn-sm" onClick={cancelAnalysis}>取消</button>
            </div>
          </div>
        )}

        {!engineReady && !analysisProgress && <div className="panel-hint">引擎加载中…</div>}

        {engineReady && !analysis && (
          <div className="panel-hint">
            {game.plies.length > 0
              ? '点击"单局面分析"分析当前局面，或"整盘分析"逐帧评估'
              : '开始对局后可进行分析'}
          </div>
        )}

        {analysis && (
          <div className="analysis-info">
            <div className="info-row">
              <span className="info-label">深度</span>
              <span className="info-value">{analysis.depth}</span>
            </div>
            <div className="info-row">
              <span className="info-label">评估</span>
              <span className={`info-value ${analysis.score >= 0 ? 'score-red' : 'score-black'}`}>
                {formatScore(analysis.score)}
              </span>
            </div>
            {analysis.bestMove && analysis.bestMove.length >= 4 && (
              <div className="info-row">
                <span className="info-label">最佳走法</span>
                <span className="info-value">
                  {chineseFromFen(analysis.fen, analysis.bestMove)}
                </span>
              </div>
            )}
            {pvCn.length > 0 && (
              <div className="pv-line">
                <div className="info-label">主变</div>
                <div className="pv-moves">
                  {pvCn.slice(0, 8).map((m, i) => (
                    <span key={i} className="pv-move">{m}</span>
                  ))}
                  {analysis!.pv.length > 8 && <span className="pv-more">…</span>}
                </div>
                {/* 主变推演入口 - 计划第15节 */}
                <button
                  className="btn btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={enterVariationFromLive}
                >
                  ▶ 在棋盘上推演此变化
                </button>
              </div>
            )}
             <div className="fen-display">
               <div className="fen-label">FEN:</div>
               <div className="fen-text">{analysis.fen}</div>
             </div>
           </div>
         )}

         {/* 拆棋·多候选着法（爱棋谱式自由拆棋） */}
         <div className="decompose-box">
           <div className="info-label" style={{ marginBottom: 4 }}>
             拆棋 · 多候选着法
             <button className="btn btn-sm" style={{ marginLeft: 8, float: 'right' }}
               disabled={!engineReady || isThinking || candLoading}
               onClick={requestCandidates}>
               {candLoading ? '分析中…' : '获取候选着法'}
             </button>
           </div>
           {mode !== 'replay' && (
             <div className="panel-hint" style={{ fontSize: 11, marginTop: 0 }}>
               进入复盘模式后，点候选着法即可在棋盘试走并形成分支
             </div>
           )}
           {cands && cands.length > 0 && (
             <div className="cand-list">
               {cands.map((c, i) => (
                 <button key={c.uci + i} className="cand-row"
                   disabled={mode !== 'replay'}
                   onClick={() => playCandidate(c.uci)}>
                   <span className="cand-rank">{i + 1}</span>
                   <span className="cand-move">{c.cn}</span>
                   <span className={`cand-score ${c.score >= 0 ? 'score-red' : 'score-black'}`}>
                     {c.score >= 100000 ? '胜势' : c.score <= -100000 ? '败势'
                       : (c.score / 100 >= 0 ? '+' : '') + (c.score / 100).toFixed(2)}
                   </span>
                 </button>
               ))}
             </div>
           )}
           {cands && cands.length === 0 && (
             <div className="panel-hint">该局面已无更好着法</div>
           )}
         </div>

        {/* 本局总结 - 计划第18节 */}
        {summary && (
          <div className="game-summary">
            <div className="info-label" style={{ marginBottom: 4 }}>本局总结</div>
            {summary.map((line, i) => (
              <div key={i} className="summary-line">{line}</div>
            ))}
          </div>
        )}

        {/* 优势曲线 - 计划第13节 */}
        <EvalCurve />

        {/* 关键时刻 - 计划第12/14节 */}
        <KeyMoments />

        {/* 走法记录 */}
        {game.plies.length > 0 && (
          <div className="move-list" style={{ marginTop: 12 }}>
            <div className="info-label" style={{ marginBottom: 4 }}>走法记录</div>
            <div className="history-list" style={{ maxHeight: 150, overflow: 'auto' }}>
               {game.plies.map((ply, i) => {
                 const tag = moveTag(ply.analysis?.classification)
                 return (
                 <span key={i} className={`history-move ${i === currentPlyIndex - 1 ? 'btn-active' : ''}`}
                   onClick={() => useStore.getState().goToPly(i + 1)}
                   style={{ cursor: 'pointer' }}>
                   {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}{ply.moveCn}
                   {tag && <i className={`move-tag ${tag.c}`}>{tag.t}</i>}
                 </span>
                 )
               })}
            </div>
          </div>
        )}

        {/* 大师参考 - 相似局面检索 */}
        <SimilarPanel
          fen={analysis?.fen ?? boardToFen(getStateAtPly(game.startFen, game.plies, currentPlyIndex))}
          moves={game.plies.slice(0, currentPlyIndex).map(p => p.move)}
        />
      </div>
    </div>
  )
}
