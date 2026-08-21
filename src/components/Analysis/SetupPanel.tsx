/**
 * 摆棋/局面分析面板 - 计划第16节
 *
 * - 手工摆棋: 放置/删除棋子
 * - 清空 / 恢复初始局面 / 翻转棋盘
 * - 开始分析 → 红方评价 + 最佳着法 + 候选着法
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import type { SetupTool } from '../../store/useStore'
import { chineseFromFen } from '../../game/rules'
import { boardToFen } from '../../game/board'

const RED_PIECES = ['K', 'A', 'B', 'N', 'R', 'C', 'P']
const BLACK_PIECES = ['k', 'a', 'b', 'n', 'r', 'c', 'p']

const GLYPHS: Record<string, string> = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
}

function formatEval(score: number, redToMove: boolean): string {
  // 引擎分数为行棋方视角 → 转红方视角
  const red = redToMove ? score : -score
  if (red >= 100000) return `红方 ${red - 100000} 步杀`
  if (red <= -100000) return `黑方 ${-red - 100000} 步杀`
  const pawns = Math.abs(red / 100).toFixed(2)
  return red >= 0 ? `红方 +${pawns}` : `黑方 +${pawns}`
}

export const SetupPanel: React.FC = () => {
  const setupTool = useStore(s => s.setupTool)
  const setupTurn = useStore(s => s.setupTurn)
  const setupCandidates = useStore(s => s.setupCandidates)
  const setupError = useStore(s => s.setupError)
  const isThinking = useStore(s => s.isThinking)
  const engineReady = useStore(s => s.engineReady)
  const board = useStore(s => s.board)
  const setSetupTool = useStore(s => s.setSetupTool)
  const setSetupTurn = useStore(s => s.setSetupTurn)
  const clearSetupBoard = useStore(s => s.clearSetupBoard)
  const resetSetupBoard = useStore(s => s.resetSetupBoard)
  const analyzeSetupPosition = useStore(s => s.analyzeSetupPosition)
  const exitSetup = useStore(s => s.exitSetup)
  const flipBoard = useStore(s => s.flipBoard)

  const renderPieceBtn = (piece: string) => {
    const active = setupTool.kind === 'piece' && setupTool.piece === piece
    const red = piece === piece.toUpperCase()
    return (
      <button
        key={piece}
        className={`setup-piece-btn ${active ? 'btn-active' : ''}`}
        onClick={() => setSetupTool({ kind: 'piece', piece } as SetupTool)}
        title={GLYPHS[piece]}
      >
        <span className={red ? 'setup-glyph-red' : 'setup-glyph-black'}>{GLYPHS[piece]}</span>
      </button>
    )
  }

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h3>摆棋分析</h3>
        <button className="btn btn-sm" onClick={exitSetup}>退出摆棋</button>
      </div>

      <div className="panel-body">
        <div className="settings-group">
          <h4>放置棋子</h4>
          <div className="setup-palette">
            {RED_PIECES.map(renderPieceBtn)}
          </div>
          <div className="setup-palette">
            {BLACK_PIECES.map(renderPieceBtn)}
            <button
              className={`setup-piece-btn ${setupTool.kind === 'erase' ? 'btn-active' : ''}`}
              onClick={() => setSetupTool({ kind: 'erase' })}
              title="擦除"
            >
              ✕
            </button>
          </div>
          <div className="panel-hint">选棋子后点击棋盘放置；点已有棋子可移除</div>
        </div>

        <div className="settings-group">
          <h4>行棋方</h4>
          <div className="setup-turn-row">
            <button
              className={`filter-btn ${setupTurn === 'w' ? 'btn-active' : ''}`}
              onClick={() => setSetupTurn('w')}
            >红方走</button>
            <button
              className={`filter-btn ${setupTurn === 'b' ? 'btn-active' : ''}`}
              onClick={() => setSetupTurn('b')}
            >黑方走</button>
          </div>
        </div>

        <div className="settings-group">
          <div className="setup-actions">
            <button className="btn btn-sm" onClick={clearSetupBoard}>清空</button>
            <button className="btn btn-sm" onClick={resetSetupBoard}>初始局面</button>
            <button className="btn btn-sm" onClick={flipBoard}>翻转</button>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px' }}
              disabled={!engineReady || isThinking}
              onClick={() => analyzeSetupPosition()}
            >
              {isThinking ? '分析中…' : '开始分析'}
            </button>
          </div>
          {setupError && <div className="setup-error">{setupError}</div>}
        </div>

        {setupCandidates && setupCandidates.length > 0 && (
          <div className="settings-group">
            <h4>分析结果</h4>
            <div className="info-row">
              <span className="info-label">评估</span>
              <span className={`info-value ${(setupTurn === 'w' ? setupCandidates[0].score : -setupCandidates[0].score) >= 0 ? 'score-red' : 'score-black'}`}>
                {formatEval(setupCandidates[0].score, setupTurn === 'w')}
              </span>
            </div>
            <div className="setup-candidates">
              {setupCandidates.map((c, i) => (
                <div key={i} className="setup-candidate-row">
                  <span className="setup-candidate-idx">{['①', '②', '③'][i] || i + 1}</span>
                  <span className="setup-candidate-move">
                    {chineseFromFen(boardToFen({ ...board, turn: setupTurn }), c.move)}
                  </span>
                  <span className="setup-candidate-score">
                    {((setupTurn === 'w' ? c.score : -c.score) / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
