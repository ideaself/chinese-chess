/**
 * 复盘教练面板
 *
 * 像高级教练一样指导学生研习对局:
 *   - 自动识别开局体系并讲解
 *   - 当前阶段（开局/中局/残局）提示
 *   - 引擎分析当前局面：评估 + 最佳着法 + 主变推演
 *   - 已整盘分析的对局直接展示每步评价
 *   - 接入 DeepSeek AI 教练自由提问
 */

import React, { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { getStateAtPly } from '../../game/model'
import { boardToFen, START_FEN } from '../../game/board'
import { chineseFromFen, pvToChinese } from '../../game/rules'
import {
  classifyRecord,
  FAMILY_INFO, DEFENSE_INFO,
} from '../../game/masterLibrary'
import type { LibraryGame } from '../../game/masterLibrary'
import { isCoachEnabled, askCoach } from '../../game/coach/aiCoach'
import type { CoachContext } from '../../game/coach/aiCoach'

const CLASS_LABELS: Record<string, string> = {
  best: '★ 最佳', excellent: '✦ 极佳', good: '● 正常',
  inaccuracy: '!? 缓着', mistake: '?! 失误', blunder: '? 大错',
  blunder2: '?? 致命失误', unknown: '—',
}

function formatScore(score: number): string {
  if (score >= 100000) return `红 ${score - 100000} 步杀`
  if (score <= -100000) return `黑 ${-score - 100000} 步杀`
  const pawns = (Math.abs(score) / 100).toFixed(1)
  return score >= 0 ? `红优 +${pawns}` : `黑优 +${pawns}`
}

export const CoachPanel: React.FC = () => {
  const game = useStore(s => s.game)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const analysis = useStore(s => s.analysis)
  const engineReady = useStore(s => s.engineReady)
  const isThinking = useStore(s => s.isThinking)
  const analyzePosition = useStore(s => s.analyzePosition)
  const enterVariationFromLive = useStore(s => s.enterVariationFromLive)

  const [question, setQuestion] = useState('')
  /** 对话历史（含正在流式生成的最后一条 assistant 消息） */
  const [chat, setChat] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [asking, setAsking] = useState(false)
  const [coachError, setCoachError] = useState('')
  const chatEndRef = React.useRef<HTMLDivElement>(null)

  // 新消息时滚动到底部
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [chat])

  // ── 开局识别（复用棋谱库分类逻辑） ──────────────────────────
  const opening = useMemo(() => {
    if (game.plies.length < 2) return null
    const rec = {
      id: 0,
      mv: game.plies.map(p => p.move).join(''),
      r: game.header.Red, b: game.header.Black,
    } as LibraryGame
    const cls = classifyRecord(rec)
    const name = DEFENSE_INFO[cls.defense!]
      ? `${FAMILY_INFO[cls.family].name}对${DEFENSE_INFO[cls.defense!].name}`
      : FAMILY_INFO[cls.family].name
    const desc = DEFENSE_INFO[cls.defense!]?.desc ?? FAMILY_INFO[cls.family].desc
    return cls.family === 'other' && !cls.defense ? null : { name, desc }
  }, [game])

  // ── 阶段判定 ────────────────────────────────────────────────
  const phase = useMemo(() => {
    const fen = currentPlyIndex === 0
      ? game.startFen
      : game.plies[currentPlyIndex - 1].fenAfter
    const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length
    if (pieces <= 11) return '残局'
    if (currentPlyIndex < 10) return '开局'
    return '中局'
  }, [game, currentPlyIndex])

  const currentPly = currentPlyIndex > 0 ? game.plies[currentPlyIndex - 1] : null

  // ── 着法中文序列（供 AI 上下文） ────────────────────────────
  const movesCn = useMemo(() => {
    const lines: string[] = []
    for (let i = 0; i < game.plies.length; i += 16) {
      const seg = game.plies.slice(i, i + 16).map((p, j) =>
        `${(i + j) % 2 === 0 ? `${Math.floor((i + j) / 2) + 1}.` : ''}${p.moveCn}`,
      ).join(' ')
      lines.push(seg)
    }
    return lines.join('\n')
  }, [game])

  const askAi = async () => {
    if (!question.trim() || asking) return
    const q = question.trim()
    setQuestion('')
    setCoachError('')
    setAsking(true)
    // 追加用户消息 + 空的助手消息（流式填充）
    const history = chat.slice(-6)
    setChat(c => [...c, { role: 'user', content: q }, { role: 'assistant', content: '' }])
    try {
      const ctx: CoachContext = {
        fen: currentPlyIndex === 0
          ? game.startFen || START_FEN
          : boardToFen(getStateAtPly(game.startFen, game.plies, currentPlyIndex)),
        movesCn,
        red: game.header.Red,
        black: game.header.Black,
        openingName: opening?.name,
      }
      if (analysis && analysis.fen === ctx.fen) {
        ctx.score = analysis.score
        ctx.bestMoveCn = analysis.bestMove ? chineseFromFen(analysis.fen, analysis.bestMove) : undefined
      }
      await askCoach(ctx, q, partial => {
        // 流式更新最后一条 assistant 消息
        setChat(c => {
          const next = [...c]
          next[next.length - 1] = { role: 'assistant', content: partial }
          return next
        })
      }, history)
    } catch (e) {
      setCoachError(e instanceof Error ? e.message : String(e))
      // 移除空的助手消息
      setChat(c => (c[c.length - 1]?.content === '' ? c.slice(0, -1) : c))
    } finally {
      setAsking(false)
    }
  }

  const plyAnalysis = currentPly?.analysis
  const pvCn = useMemo(
    () => (analysis && analysis.bestMove ? pvToChinese(analysis.fen, [analysis.bestMove, ...analysis.pv]) : []),
    [analysis],
  )

  return (
    <div className="coach-panel">
      <div className="panel-header">
        <h3>🧑‍🏫 教练指导</h3>
      </div>

      {/* 开局与阶段 */}
      <div className="coach-section">
        <div className="info-row">
          <span className="info-label">开局</span>
          <span className="info-value">{opening ? opening.name : '—'}</span>
        </div>
        {opening && <div className="coach-desc">{opening.desc}</div>}
        <div className="info-row">
          <span className="info-label">阶段</span>
          <span className="info-value">
            {phase} · 第 {Math.ceil(currentPlyIndex / 2)} 回合 / 共 {Math.ceil(game.plies.length / 2)} 回合
          </span>
        </div>
      </div>

      {/* 刚走的这步 */}
      {currentPly && (
        <div className="coach-section">
          <div className="info-row">
            <span className="info-label">上一手</span>
            <span className="info-value">
              {currentPly.turn === 'w' ? '红' : '黑'} {currentPly.moveCn}
              {plyAnalysis && (
                <span className={`coach-grade grade-${plyAnalysis.classification}`} style={{ marginLeft: 8 }}>
                  {CLASS_LABELS[plyAnalysis.classification]}
                  {plyAnalysis.moveLoss > 30 ? ` (损失 ${(plyAnalysis.moveLoss / 100).toFixed(1)})` : ''}
                </span>
              )}
            </span>
          </div>
          {plyAnalysis?.bestMoveCn && plyAnalysis.classification !== 'best' && (
            <div className="coach-desc">教练建议: 此处更好的选择是 {plyAnalysis.bestMoveCn}</div>
          )}
          {!plyAnalysis && (
            <div className="coach-desc">整盘分析后，教练会逐步点评每手棋的优劣</div>
          )}
        </div>
      )}

      {/* 引擎分析 */}
      <div className="coach-section">
        <button className="btn btn-sm btn-primary" style={{ width: '100%' }}
          onClick={() => analyzePosition()}
          disabled={!engineReady || isThinking}>
          {isThinking ? '⚙ 分析中…' : '🔍 引擎分析当前局面'}
        </button>
        {analysis && (
          <>
            <div className="info-row" style={{ marginTop: 6 }}>
              <span className="info-label">评估</span>
              <span className={`info-value ${analysis.score >= 0 ? 'score-red' : 'score-black'}`}>
                {formatScore(analysis.score)}（深度{analysis.depth}）
              </span>
            </div>
            {analysis.fen !== (currentPlyIndex === 0 ? game.startFen : currentPly?.fenAfter) && (
              <div className="coach-desc">⚠ 显示的是上次分析的局面，重新点击分析</div>
            )}
            {pvCn.length > 1 && (
              <div className="pv-line">
                <div className="info-label">推荐变化</div>
                <div className="pv-moves">
                  {pvCn.slice(0, 6).map((m, i) => <span key={i} className="pv-move">{m}</span>)}
                </div>
                <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={enterVariationFromLive}>
                  ▶ 在棋盘上推演此变化
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* AI 教练问答 */}
      <div className="coach-section">
        {isCoachEnabled() ? (
          <>
            {chat.length > 0 && (
              <div className="coach-chat">
                {chat.map((m, i) => (
                  <div key={i} className={`coach-bubble ${m.role}`}>{m.content}</div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
            <textarea
              className="import-textarea"
              rows={2}
              placeholder={asking ? '教练思考中…' : '向 AI 教练提问… 可连续追问（如「为什么？」「那如果黑方反击呢？」）'}
              value={question}
              onChange={e => { setQuestion(e.target.value); setCoachError('') }}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button className="btn btn-sm btn-primary" style={{ flex: 1 }}
                onClick={askAi} disabled={asking || !question.trim()}>
                {asking ? '💬 教练思考中…' : '💬 请教 AI 教练'}
              </button>
              {chat.length > 0 && !asking && (
                <button className="btn btn-sm" title="清空对话"
                  onClick={() => setChat([])}>🗑</button>
              )}
            </div>
            {coachError && <div className="import-error">{coachError}</div>}
          </>
        ) : (
          <div className="coach-desc">
            💡 在「设置 → AI 教练」填入 DeepSeek API Key，
            即可随时向 AI 教练提问，获得针对局面的自然语言讲解。
          </div>
        )}
      </div>

      {/* 对局信息 */}
      {(game.header.Red || game.header.Event) && (
        <div className="coach-desc" style={{ marginTop: 4 }}>
          {game.header.Title || `${game.header.Red || '红方'} vs ${game.header.Black || '黑方'}`}
          {game.header.Event ? ` · ${game.header.Event}` : ''}
        </div>
      )}
    </div>
  )
}
