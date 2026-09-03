/**
 * 移动端首页：每日一题卡片 + 三个大按钮导航
 */
import React, { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import type { MobilePage } from '../../store/slices/uiSlice'
import { loadPuzzles, PUZZLE_TYPES, puzzleDifficulty, getDailyPuzzle } from '../../game/puzzles'
import type { PuzzleItem, PuzzleType } from '../../game/puzzles'
import { getPuzzleStreak, isDailyDone } from '../../game/progress'

const MENU_ITEMS: { page: MobilePage; icon: string; label: string; desc: string }[] = [
  { page: 'play', icon: '♟', label: '对战', desc: '人机对战 / 双人对弈' },
  { page: 'games', icon: '📖', label: '棋谱', desc: '大师棋局 / 复盘分析' },
  { page: 'settings', icon: '⚙', label: '设置', desc: '外观 / 音效 / 引擎' },
]

/** 首个有题的每日挑战（按固定顺序，同一天稳定） */
function pickDaily(list: (PuzzleItem | null)[]): { type: PuzzleType; puzzle: PuzzleItem } | null {
  for (let i = 0; i < PUZZLE_TYPES.length; i++) {
    if (list[i]) return { type: PUZZLE_TYPES[i], puzzle: list[i]! }
  }
  return null
}

export const MobileHome: React.FC = () => {
  const setMobilePage = useStore(s => s.setMobilePage)
  const setGamesSubTab = useStore(s => s.setGamesSubTab)
  const setTrainingAutoStart = useStore(s => s.setTrainingAutoStart)

  const [daily, setDaily] = useState<{ type: PuzzleType; puzzle: PuzzleItem } | null>(null)
  const [streak, setStreak] = useState(() => getPuzzleStreak())
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    loadPuzzles().then(ok => {
      if (!ok || !alive) return
      const list = PUZZLE_TYPES.map(t => getDailyPuzzle(t))
      const pick = pickDaily(list)
      if (pick) {
        setDaily(pick)
        setDone(isDailyDone(pick.type))
        setStreak(getPuzzleStreak())
      }
    })
    return () => { alive = false }
  }, [])

  const goDaily = () => {
    if (!daily) return
    setGamesSubTab('training')
    setMobilePage('games')
    setTrainingAutoStart('daily')
  }

  return (
    <div className="mobile-home">
      <div className="mobile-home-title">♟ 中国象棋</div>
      {daily && (
        <button className="mobile-home-daily" onClick={goDaily}>
          <span className="mobile-home-daily-icon">☀️</span>
          <span className="mobile-home-daily-main">
            <span className="mobile-home-daily-label">
              每日一题 · {daily.type}{done ? ' ✓ 已完成' : ''}
            </span>
            <span className="mobile-home-daily-desc">
              {puzzleDifficulty(daily.puzzle)} · {streak.count > 0 ? `🔥 连对 ${streak.count} 题` : '找出实战最佳着'}
            </span>
          </span>
          <span className="mobile-home-daily-go">{done ? '再看' : '去挑战'} →</span>
        </button>
      )}
      <div className="mobile-home-menu">
        {MENU_ITEMS.map(item => (
          <button
            key={item.page}
            className="mobile-home-btn"
            onClick={() => setMobilePage(item.page)}
          >
            <span className="mobile-home-icon">{item.icon}</span>
            <span className="mobile-home-label">{item.label}</span>
            <span className="mobile-home-desc">{item.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
