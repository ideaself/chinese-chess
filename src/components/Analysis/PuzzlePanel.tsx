/**
 * 错误重走面板 - 计划第17节
 *
 * 回到失误局面（隐藏答案），用户重新走:
 *   - 命中最佳着法 → ✓ 正确
 *   - 否则 → 不是最佳着法，再想想
 *
 * 也支持精选题库题目（puzzleSource 非空：杀局/失误题/残局题）。
 */

import React from 'react'
import { useStore } from '../../store/useStore'

export const PuzzlePanel: React.FC = () => {
  const game = useStore(s => s.game)
  const puzzlePlyIndex = useStore(s => s.puzzlePlyIndex)
  const puzzleAttempts = useStore(s => s.puzzleAttempts)
  const puzzleResult = useStore(s => s.puzzleResult)
  const puzzleRevealed = useStore(s => s.puzzleRevealed)
  const puzzleSource = useStore(s => s.puzzleSource)
  const exitPuzzle = useStore(s => s.exitPuzzle)
  const revealPuzzleAnswer = useStore(s => s.revealPuzzleAnswer)

  if (puzzlePlyIndex === null) return null
  const ply = game.plies[puzzlePlyIndex]
  if (!ply) return null

  const isLibrary = puzzleSource !== null
  const answerCn = ply.analysis?.bestMoveCn
    ?? (ply.analysis?.bestMove && ply.analysis.bestMove.length >= 4 ? ply.analysis.bestMove : undefined)

  const typeLabel = puzzleSource?.type || '重新挑战'

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h3>{isLibrary ? `${typeLabel} · ${puzzleSource.title || '实战精选'}` : `重新挑战 · 第${Math.floor(puzzlePlyIndex / 2) + 1}回合`}</h3>
        <button className="btn btn-sm" onClick={exitPuzzle}>退出</button>
      </div>

      <div className="panel-body">
        {isLibrary ? (
          <div className="panel-hint">
            实战{ply.moveCn || '这一手'}不是最佳着法（掉分 {puzzleSource.drop}cp）。<br />
            该你走了（执{puzzleSource.mover === 'w' ? '红' : '黑'}），找出最佳着：
          </div>
        ) : (
          <div className="panel-hint">
            你当时走了 <b>{ply.moveCn}</b>，这是一步失误。<br />
            请走出更好的着法：
          </div>
        )}

        {puzzleResult === 'correct' && (
          <div className="puzzle-result puzzle-correct">✓ 正确！就是这一手</div>
        )}

        {puzzleResult === 'wrong' && (
          <>
            <div className="puzzle-result puzzle-wrong">✗ 不是最佳着法，再想想</div>
            {puzzleAttempts > 1 && (
              <div className="panel-hint">已尝试 {puzzleAttempts} 次</div>
            )}
          </>
        )}

        {puzzleRevealed && answerCn && (
          <div className="puzzle-answer">
            应走：<b>{answerCn}</b>
            {puzzleSource && <span className="panel-hint">（实战着 {ply.moveCn || ply.move}）</span>}
          </div>
        )}

        <div className="setup-actions" style={{ marginTop: 12 }}>
          {!puzzleRevealed && puzzleResult !== 'correct' && (
            <button className="btn btn-sm" onClick={revealPuzzleAnswer}>放弃并查看答案</button>
          )}
          {(puzzleRevealed || puzzleResult === 'correct') && (
            <button className="btn btn-primary" style={{ padding: '8px 16px' }} onClick={exitPuzzle}>
              退出
            </button>
          )}
        </div>
      </div>
    </div>
  )
}