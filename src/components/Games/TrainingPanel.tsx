/**
 * 训练面板 - 计划第22节"残局训练 / 开局训练" + 实战精选题库
 *
 * 板块:
 *   - 自适应出题: 按弱点/正确率智能选题（v1.21）
 *   - 开局定式: 玩家执红按理论行棋，走偏提示
 *   - 实战精选: 141k 局大师棋谱提取的杀局/失误题/残局题（找最佳着）
 *   - 残局练习: 经典必胜局面 vs 引擎防守，带通关进度
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { ENDGAME_PRESETS } from '../../game/endgames'
import { getOpeningLines, ensureBookOpeningLines } from '../../game/openings'
import {
  loadPuzzles, getPuzzles, getPuzzlesByType, getDailyPuzzle, getPuzzleStreak,
  puzzleDifficulty, type PuzzleItem, type PuzzleType,
} from '../../game/puzzles'
import { getTrainingProgress, isDailyDone } from '../../game/progress'
import { getWeaknessAnalysis } from '../../game/storage'
import { pickAdaptivePuzzle, pickDuePuzzle, duePuzzleCount } from '../../game/training'

type DiffFilter = 'all' | '初级' | '中级' | '高级'

/** 难度筛选跨挂载保留：答题期间训练面板会卸载，返回时不该被重置 */
let lastDiffFilter: DiffFilter = 'all'

const TYPE_LABEL: Record<PuzzleType, string> = {
  '杀局': '必胜局面找杀着',
  '失误题': '严重失误后找回',
  '残局题': '残局阶段找回',
}

export const TrainingPanel: React.FC = () => {
  const startEndgameTraining = useStore(s => s.startEndgameTraining)
  const startOpeningTraining = useStore(s => s.startOpeningTraining)
  const startLibraryPuzzle = useStore(s => s.startLibraryPuzzle)
  const startMasterQuiz = useStore(s => s.startMasterQuiz)
  const engineReady = useStore(s => s.engineReady)
  const trainingAutoStart = useStore(s => s.trainingAutoStart)
  const setTrainingAutoStart = useStore(s => s.setTrainingAutoStart)
  const [puzzles, setPuzzles] = useState<Record<string, PuzzleItem[]> | null>(null)
  const [diff, setDiff] = useState<DiffFilter>(lastDiffFilter)
  const [streak, setStreak] = useState(() => getPuzzleStreak())
  const [progressVersion, setProgressVersion] = useState(0)
  const [linesVersion, setLinesVersion] = useState(0)

  // 开局书生成训练线路（失败保持内置定式）；完成后刷新列表
  useEffect(() => {
    let alive = true
    void ensureBookOpeningLines().then(() => { if (alive) setLinesVersion(v => v + 1) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    loadPuzzles().then(ok => {
      if (ok) {
        setPuzzles({
          '杀局': getPuzzlesByType('杀局', 60),
          '失误题': getPuzzlesByType('失误题', 60),
          '残局题': getPuzzlesByType('残局题', 60),
        })
      }
    })
  }, [])

  // 主页每日一题卡片 → 自动开始今日挑战
  useEffect(() => {
    if (trainingAutoStart !== 'daily' || !puzzles) return
    setTrainingAutoStart(null)
    const daily = (['杀局', '失误题', '残局题'] as PuzzleType[])
      .map(t => getDailyPuzzle(t))
      .find(p => p !== null)
    if (daily) startDaily(daily)
  }, [trainingAutoStart, puzzles, setTrainingAutoStart])

  const weakness = useMemo(() => getWeaknessAnalysis(), [])
  const adaptive = useMemo(
    () => (puzzles ? pickAdaptivePuzzle(weakness) : null),
    [puzzles, weakness, progressVersion],
  )
  const endgameProg = useMemo(
    () => getTrainingProgress().endgames,
    [progressVersion],
  )
  const openingLines = useMemo(() => getOpeningLines(), [linesVersion])
  const openingProg = useMemo(() => getTrainingProgress().openings, [progressVersion])
  // SRS 到期复习：已练过且到期的题目
  const dueCount = useMemo(
    () => (puzzles ? duePuzzleCount(getPuzzles() ?? []) : 0),
    [puzzles, progressVersion],
  )
  const duePuzzle = useMemo(
    () => (puzzles ? pickDuePuzzle(getPuzzles() ?? []) : null),
    [puzzles, progressVersion],
  )

  const daily = useMemo(() => {
    if (!puzzles) return null
    return (['杀局', '失误题', '残局题'] as PuzzleType[]).map(t => ({
      type: t,
      puzzle: getDailyPuzzle(t),
    }))
  }, [puzzles, progressVersion])

  const pickFromType = (type: PuzzleType) => {
    const list = (puzzles?.[type] ?? []).filter(p => diff === 'all' || puzzleDifficulty(p) === diff)
    const pool = list.length > 0 ? list : (puzzles?.[type] ?? [])
    if (pool.length === 0) return
    const p = pool[Math.floor(Math.random() * pool.length)]
    startLibraryPuzzle(p)
    setStreak(getPuzzleStreak())
    setProgressVersion(v => v + 1)
  }

  const startDaily = (p: PuzzleItem | null) => {
    if (p) {
      startLibraryPuzzle(p)
      setStreak(getPuzzleStreak())
      setProgressVersion(v => v + 1)
    }
  }

  const startAdaptive = () => {
    if (adaptive) {
      startLibraryPuzzle(adaptive.puzzle)
      setStreak(getPuzzleStreak())
      setProgressVersion(v => v + 1)
    }
  }

  const refreshProgress = () => {
    setStreak(getPuzzleStreak())
    setProgressVersion(v => v + 1)
  }

  return (
    <div className="training-panel">
      {/* ── 今日复习（SRS 到期队列） ── */}
      {duePuzzle && (
        <>
          <div className="ctrl-title" style={{ marginBottom: 8 }}>📅 今日复习</div>
          <div className="training-list" style={{ marginBottom: 16 }}>
            <div className="training-item">
              <div className="training-info">
                <div className="training-name">待复习 {dueCount} 题</div>
                <div className="training-desc">
                  按间隔复习排期到期：答对一次间隔 1→3→7→21→60 天，答错 10 分钟后再来
                </div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '8px 16px', flexShrink: 0 }}
                onClick={() => { startLibraryPuzzle(duePuzzle); refreshProgress() }}
              >开始复习</button>
            </div>
          </div>
        </>
      )}

      {/* ── 自适应出题 ── */}
      {adaptive && (
        <>
          <div className="ctrl-title" style={{ marginBottom: 8 }}>⚡ 智能出题</div>
          <div className="training-list" style={{ marginBottom: 16 }}>
            <div className="training-item">
              <div className="training-info">
                <div className="training-name">{adaptive.label}</div>
                <div className="training-desc">{adaptive.reason}</div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '8px 16px', flexShrink: 0 }}
                onClick={startAdaptive}
              >开始</button>
            </div>
          </div>
        </>
      )}

      {/* ── 开局训练 ── */}
      <div className="ctrl-title" style={{ marginBottom: 8 }}>♟ 开局定式训练</div>
      <div className="panel-hint" style={{ marginBottom: 8 }}>
        线路由 141k 局大师语料生成，逐手标注出现局数与红方得分率；走偏会提示正确着法。
        {Object.values(openingProg).filter(o => o.completed).length > 0 &&
          ` 已掌握 ${Object.values(openingProg).filter(o => o.completed).length}/${openingLines.length} 条`}
      </div>
      <div className="training-list" style={{ marginBottom: 16 }}>
        {openingLines.map(l => {
          const prog = openingProg[l.id]
          return (
            <div key={l.id} className="training-item">
              <div className="training-info">
                <div className="training-name">
                  {l.name}
                  {prog?.completed && <span style={{ marginLeft: 6 }}>✓</span>}
                </div>
                <div className="training-desc">
                  {l.desc}
                  {prog && (
                    <span style={{ marginLeft: 6 }}>
                      （尝试 {prog.attempts} 次{prog.completed ? '，已掌握' : ''}）
                    </span>
                  )}
                </div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '8px 16px', flexShrink: 0 }}
                onClick={() => startOpeningTraining(l.id)}
              >开始</button>
            </div>
          )
        })}
      </div>

      {/* ── 实战精选（题库） ── */}
      <div className="ctrl-title" style={{ marginBottom: 8 }}>🎯 实战精选题库</div>
      <div className="panel-hint" style={{ marginBottom: 8 }}>
        从 141k 局大师棋谱 + Pikafish 分析提取：找出实战中该走的最佳着。
        {streak.count > 0 && <b style={{ marginLeft: 8 }}>🔥 连对 {streak.count} 题</b>}
      </div>

      {puzzles ? (
        <>
          {/* 每日挑战 */}
          <div className="training-list" style={{ marginBottom: 8 }}>
            {daily?.map(({ type, puzzle }) => {
              const done = isDailyDone(type)
              return (
                <div key={type} className="training-item">
                  <div className="training-info">
                    <div className="training-name">☀️ 每日挑战 · {type}{done ? ' ✓ 已完成' : ''}</div>
                    <div className="training-desc">
                      {TYPE_LABEL[type]} · 今日固定一题
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '8px 16px', flexShrink: 0 }}
                    disabled={!puzzle}
                    onClick={() => startDaily(puzzle)}
                  >{done ? '再练' : '挑战'}</button>
                </div>
              )
            })}
          </div>

          {/* 难度筛选 */}
          <div className="controls-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            {(['all', '初级', '中级', '高级'] as DiffFilter[]).map(d => (
              <button key={d} className={`btn btn-sm ${diff === d ? 'btn-active' : ''}`}
                onClick={() => { lastDiffFilter = d; setDiff(d) }}>
                {d === 'all' ? '全部难度' : d}
              </button>
            ))}
          </div>

          {/* 随机抽题 */}
          <div className="training-list" style={{ marginBottom: 16 }}>
            {(Object.keys(puzzles) as PuzzleType[]).map(type => {
              const stat = getTrainingProgress().puzzle.byType[type]
              const acc = stat && stat.asked >= 3 ? ` · 正确率 ${Math.round((stat.right / stat.asked) * 100)}%` : ''
              return (
                <div key={type} className="training-item">
                  <div className="training-info">
                    <div className="training-name">{type}</div>
                    <div className="training-desc">
                      {TYPE_LABEL[type]} · {puzzles[type].length} 题
                      {diff !== 'all' ? `（${diff}）` : ''}{acc}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '8px 16px', flexShrink: 0 }}
                    disabled={puzzles[type].length === 0}
                    onClick={() => pickFromType(type)}
                  >随机一题</button>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="panel-hint" style={{ marginBottom: 16 }}>题库加载中…</div>
      )}

      {/* ── 名局拆解 ── */}
      <div className="ctrl-title" style={{ marginBottom: 8 }}>🎯 名局拆解</div>
      <div className="training-list" style={{ marginBottom: 16 }}>
        <div className="training-item">
          <div className="training-info">
            <div className="training-name">猜大师的着法</div>
            <div className="training-desc">
              从 141k 局大师棋谱随机取一局，逐步猜大师实战着法；答错可用引擎判定"殊途同归"
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ padding: '8px 16px', flexShrink: 0 }}
            onClick={() => startMasterQuiz()}
          >开始</button>
        </div>
      </div>

      {/* ── 残局训练 ── */}
      <div className="ctrl-title" style={{ marginBottom: 8 }}>♛ 残局杀王练习</div>
      <div className="panel-hint" style={{ marginBottom: 8 }}>
        选择一个经典残局，你执红先行，引擎执黑防守。
        {Object.values(endgameProg).filter(e => e.completed).length > 0 &&
          ` 已通关 ${Object.values(endgameProg).filter(e => e.completed).length}/${ENDGAME_PRESETS.length}`}
      </div>
      <div className="training-list">
        {ENDGAME_PRESETS.map(p => {
          const prog = endgameProg[p.id]
          return (
            <div key={p.id} className="training-item">
              <div className="training-info">
                <div className="training-name">
                  {p.name}
                  {prog?.completed && <span style={{ marginLeft: 6 }}>✓</span>}
                </div>
                <div className="training-desc">
                  {p.desc}
                  {prog && (
                    <span style={{ marginLeft: 6 }}>
                      （尝试 {prog.attempts} 次{prog.completed ? '，已通关' : ''}）
                    </span>
                  )}
                </div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '8px 16px', flexShrink: 0 }}
                disabled={!engineReady}
                onClick={() => startEndgameTraining(p.fen, p.name)}
              >开始</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
