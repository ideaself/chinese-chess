/**
 * 名局拆解训练 - 猜大师的着法
 *
 * 从大师棋谱库随机选局，逐步隐藏大师的实际着法，
 * 玩家从候选中选出；答错也展示实战着法并讲解。
 */

import React from 'react'
import { useStore } from '../../store/useStore'
import { boardFromFen } from '../../game/board'
import { chineseFromFen } from '../../game/rules'

function quizFenAt(game: { startFen: string; plies: Array<{ fenAfter: string }> }, ply: number): string {
  return ply === 0 ? game.startFen : game.plies[ply - 1].fenAfter
}

export const MasterQuizPanel: React.FC = () => {
  const quiz = useStore(s => s.masterQuiz)
  const game = useStore(s => s.game)
  const answerMasterQuiz = useStore(s => s.answerMasterQuiz)
  const nextQuizPly = useStore(s => s.nextQuizPly)
  const exitMasterQuiz = useStore(s => s.exitMasterQuiz)
  const startMasterQuiz = useStore(s => s.startMasterQuiz)

  if (!quiz) return null

  const finished = quiz.ply >= quiz.total
  const fen = quizFenAt(game, Math.min(quiz.ply, quiz.total))
  const turnW = boardFromFen(fen).turn === 'w'
  const accuracy = quiz.asked > 0 ? Math.round((quiz.right / quiz.asked) * 100) : null

  return (
    <div className="coach-panel">
      <div className="panel-header">
        <h3>🎯 名局拆解</h3>
        <button className="btn btn-sm" onClick={exitMasterQuiz}>✕ 退出</button>
      </div>

      {/* 对局信息 */}
      <div className="coach-section">
        <div style={{ fontSize: 13, color: 'var(--text)' }}>
          {game.header.Title || `${game.header.Red || '红方'} vs ${game.header.Black || '黑方'}`}
        </div>
        {(game.header.Event || game.header.Date) && (
          <div className="coach-desc">
            {[game.header.Event, !/^0000/.test(game.header.Date || '') ? game.header.Date : '']
              .filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {!finished ? (
        <>
          {/* 进度与战绩 */}
          <div className="coach-section">
            <div className="info-row">
              <span className="info-label">进度</span>
              <span className="info-value">第 {quiz.ply + 1}/{quiz.total} 手</span>
            </div>
            <div className="info-row">
              <span className="info-label">战绩</span>
              <span className="info-value">
                {quiz.right}/{quiz.asked}
                {accuracy !== null ? ` · ${accuracy}%` : ''} · 连对 {quiz.streak} 🔥
              </span>
            </div>
          </div>

          {/* 提问 */}
          {quiz.status === 'asking' && (
            <div className="coach-section">
              <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 6 }}>
                轮到{turnW ? '红' : '黑'}方，猜大师怎么走？
              </div>
              <div className="quiz-options">
                {quiz.options.map(u => (
                  <button key={u} className="btn quiz-option"
                    onClick={() => answerMasterQuiz(u)}>
                    {chineseFromFen(fen, u)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 反馈 */}
          {quiz.status !== 'asking' && (
            <div className="coach-section">
              <div className={`quiz-verdict ${quiz.status}`}>
                {quiz.status === 'correct' ? '✓ 正确！大师也是这么走的' : '✗ 不是这手'}
              </div>
              {quiz.status === 'wrong' && quiz.answered && (
                <div className="coach-desc">
                  你的选择: {chineseFromFen(fen, quiz.answered)}
                </div>
              )}
              <div className="coach-desc" style={{ marginTop: 4 }}>
                大师实战: <b>{chineseFromFen(fen, quiz.correct)}</b>（已在棋盘上演示）
              </div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }}
                onClick={nextQuizPly}>
                下一手 →
              </button>
            </div>
          )}

          <button className="btn btn-sm" style={{ width: '100%' }} onClick={startMasterQuiz}>
            🔄 换一局
          </button>
        </>
      ) : (
        /* 完赛总结 */
        <div className="coach-section">
          <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 6 }}>🏁 拆解完成！</div>
          <div className="info-row">
            <span className="info-label">正确率</span>
            <span className="info-value">{quiz.right}/{quiz.asked} · {accuracy}%</span>
          </div>
          <div className="info-row">
            <span className="info-label">最高连对</span>
            <span className="info-value">{quiz.bestStreak}</span>
          </div>
          <div className="coach-desc" style={{ margin: '6px 0' }}>
            {accuracy! >= 80 ? '大师级直觉！你对局面的理解非常到位。'
              : accuracy! >= 50 ? '不错的棋感，多拆解几局可以更快抓住要点。'
                : '别灰心，跟着大师的思路走一遍，重点体会每步的目的。'}
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: 6 }}
            onClick={startMasterQuiz}>再来一局</button>
          <button className="btn" style={{ width: '100%' }} onClick={exitMasterQuiz}>退出拆解</button>
        </div>
      )}
    </div>
  )
}
