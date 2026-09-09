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
import { puzzleHintPiece, puzzleHintNature, type PuzzleItem } from '../../game/puzzles'

export const PuzzlePanel: React.FC = () => {
  const game = useStore(s => s.game)
  const puzzlePlyIndex = useStore(s => s.puzzlePlyIndex)
  const puzzleAttempts = useStore(s => s.puzzleAttempts)
  const puzzleResult = useStore(s => s.puzzleResult)
  const puzzleRevealed = useStore(s => s.puzzleRevealed)
  const puzzleHintLevel = useStore(s => s.puzzleHintLevel)
  const puzzleSource = useStore(s => s.puzzleSource)
  const exitPuzzle = useStore(s => s.exitPuzzle)
  const nextLibraryPuzzle = useStore(s => s.nextLibraryPuzzle)
  const revealPuzzleHint = useStore(s => s.revealPuzzleHint)
  const revealPuzzleAnswer = useStore(s => s.revealPuzzleAnswer)
  const puzzleLine = useStore(s => s.puzzleLine)
  const puzzleLineLoading = useStore(s => s.puzzleLineLoading)
  const loadPuzzleLine = useStore(s => s.loadPuzzleLine)

  // 答对后自动推演后续变化（"为什么应走这步"），看答案时手动触发
  React.useEffect(() => {
    if (puzzleResult === 'correct') loadPuzzleLine()
  }, [puzzleResult, loadPuzzleLine])

  if (puzzlePlyIndex === null) return null
  const ply = game.plies[puzzlePlyIndex]
  if (!ply) return null

  const isLibrary = puzzleSource !== null
  const answerCn = ply.analysis?.bestMoveCn
    ?? (ply.analysis?.bestMove && ply.analysis.bestMove.length >= 4 ? ply.analysis.bestMove : undefined)

  const typeLabel = puzzleSource?.type || '重新挑战'
  const moverCn = puzzleSource?.mover === 'w' ? '红' : '黑'
  // 题库里 62 道「杀局」实为败势防守题，按局面事实标注，避免提示与局面相反
  const taskLabel = puzzleSource?.task === '防守' ? `${typeLabel}·防守` : typeLabel

  // 分级提示：题库题按题目数据生成；错题重走用当前局面构造同结构对象
  const hintSource: PuzzleItem | null = puzzleSource
    ? ({
        type: puzzleSource.type, game_id: 0, ply: 0, fen: ply.fenBefore,
        move_uci: ply.move, best_move: ply.analysis?.bestMove ?? '', score_before: 0,
        score_drop: 0, result: '', event: '', red: '', black: '',
      } as PuzzleItem)
    : null
  const hintPiece = puzzleHintLevel >= 1 && hintSource ? puzzleHintPiece(hintSource) : ''
  const hintNature = puzzleHintLevel >= 2 && hintSource ? puzzleHintNature(hintSource) : ''

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h3>{isLibrary
          ? `${taskLabel} · ${puzzleSource.difficulty} · ${puzzleSource.title || '实战精选'}`
          : `重新挑战 · 第${Math.floor(puzzlePlyIndex / 2) + 1}回合`}</h3>
        <button className="btn btn-sm" onClick={exitPuzzle}>退出</button>
      </div>

      <div className="panel-body">
        {isLibrary ? (
          <div className="panel-hint">
            {puzzleSource.task === '防守' ? (
              <>
                局面已成败势，实战中{moverCn}方走出了最顽强的防守着。<br />
                该你走了（执{moverCn}），请找出最好的防守：
              </>
            ) : puzzleSource.task === '杀王' && puzzleSource.type === '杀局' ? (
              <>
                局面已到制胜时刻，实战中{moverCn}方走出了杀着。<br />
                该你走了（执{moverCn}），请还原实战杀着：
              </>
            ) : puzzleSource.task === '杀王' ? (
              <>
                局面已到制胜时刻，实战中{moverCn}方却错失了杀着。<br />
                该你走了（执{moverCn}），请找出制胜的着法：
              </>
            ) : (
              <>
                实战{ply.moveCn || '这一手'}不是最佳着法
                {puzzleSource.drop > 0 ? `（${puzzleSource.dropText}）` : ''}。<br />
                该你走了（执{moverCn}），找出最佳着：
              </>
            )}
          </div>
        ) : (
          <div className="panel-hint">
            你当时走了 <b>{ply.moveCn}</b>，这是一步失误。<br />
            请走出更好的着法：
          </div>
        )}

        {(hintPiece || hintNature) && puzzleResult !== 'correct' && !puzzleRevealed && (
          <div className="puzzle-hint-lines">
            {hintPiece && <div>💡 提示 1：该动的是 <b>{hintPiece}</b></div>}
            {hintNature && <div>💡 提示 2：{hintNature}</div>}
          </div>
        )}

        {puzzleResult === 'correct' && (
          <div className="puzzle-result puzzle-correct">
            {puzzleSource?.aiAgree ? '✓ 殊途同归！AI 也推荐这手棋' : '✓ 正确！就是这一手'}
          </div>
        )}

        {puzzleResult === 'wrong' && (
          <>
            <div className="puzzle-result puzzle-wrong">✗ 不是最佳着法，再想想</div>
            {puzzleSource?.checking && (
              <div className="panel-hint">⏳ 正在请引擎确认这手棋是否同样好…</div>
            )}
            {puzzleAttempts > 1 && (
              <div className="panel-hint">已尝试 {puzzleAttempts} 次</div>
            )}
          </>
        )}

        {puzzleRevealed && answerCn && (
          <div className="puzzle-answer">
            应走：<b>{answerCn}</b>
            {puzzleSource && answerCn !== (ply.moveCn || ply.move) &&
              <span className="panel-hint">（实战着 {ply.moveCn || ply.move}）</span>}
          </div>
        )}

        {/* 后续变化：把"应走 X"补成"应走 X，因为之后……" */}
        {(puzzleResult === 'correct' || puzzleRevealed) && (
          <div className="puzzle-line">
            {puzzleLineLoading ? (
              <div className="panel-hint">⏳ 引擎正在推演后续变化…</div>
            ) : puzzleLine && puzzleLine.length > 0 ? (
              <>
                <div className="info-label">后续变化</div>
                <div className="pv-moves">
                  {puzzleLine.map((m, i) => <span key={i} className="pv-move">{m}</span>)}
                </div>
              </>
            ) : puzzleLine !== null ? (
              <div className="panel-hint">此后局面已定（无续着）。</div>
            ) : (
              <button className="btn btn-sm" onClick={loadPuzzleLine}>🧩 看后续变化（为什么）</button>
            )}
          </div>
        )}

        <div className="setup-actions" style={{ marginTop: 12 }}>
          {!puzzleRevealed && puzzleResult !== 'correct' && (
            <>
              {/* 分级提示：先给子力，再给着法性质，最后才看答案 */}
              {puzzleHintLevel < 2 && (
                <button className="btn btn-sm" onClick={revealPuzzleHint}>
                  {puzzleHintLevel === 0 ? '💡 提示' : '💡 再提示一点'}
                </button>
              )}
              <button className="btn btn-sm" onClick={revealPuzzleAnswer}>放弃并查看答案</button>
            </>
          )}
          {(puzzleRevealed || puzzleResult === 'correct') && (
            <>
              {/* 题库题可直接换下一题（同题型/同难度优先），不必退出再重新进入 */}
              {isLibrary && (
                <button className="btn btn-primary" style={{ padding: '8px 16px' }} onClick={nextLibraryPuzzle}>
                  {puzzleResult === 'correct' ? '下一题 →' : '换一题 →'}
                </button>
              )}
              <button className={`btn ${isLibrary ? 'btn-sm' : 'btn-primary'}`}
                style={{ padding: '8px 16px' }} onClick={exitPuzzle}>
                退出
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}