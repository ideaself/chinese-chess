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

import React, { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { getStateAtPly } from '../../game/model'
import { boardToFen } from '../../game/board'
import { chineseFromFen, pvToChinese } from '../../game/rules'
import { generateGameSummary } from '../../game/summary'
import { EvalCurve } from './EvalCurve'
import { KeyMoments } from './KeyMoments'

function formatScore(score: number): string {
  if (score >= 100000) return `胜势 (${score - 100000}步杀)`
  if (score <= -100000) return `败势 (${-score - 100000}步被杀)`
  const pawns = (score / 100).toFixed(1)
  return score >= 0 ? `红优 +${pawns}` : `黑优 ${pawns}`
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
        </div>
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

        {/* 棋谱走法列表 */}
        {game.plies.length > 0 && (
          <div className="move-list" style={{ marginTop: 12 }}>
            <div className="info-label" style={{ marginBottom: 4 }}>走法记录</div>
            <div className="history-list" style={{ maxHeight: 150, overflow: 'auto' }}>
              {game.plies.map((ply, i) => (
                <span key={i} className={`history-move ${i === currentPlyIndex - 1 ? 'btn-active' : ''}`}
                  onClick={() => useStore.getState().goToPly(i + 1)}
                  style={{ cursor: 'pointer' }}>
                  {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}{ply.moveCn}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
