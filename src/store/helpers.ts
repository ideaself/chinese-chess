/**
 * Store 纯辅助函数（无 store 依赖）
 */
import type { Move, Turn } from '../game/board'
import type { Game } from '../game/model'
import type { Difficulty, LastRatingChange, StoreSet, StoreGet } from './types'
import type { BoardState } from '../game/board'
import { boardFromFen } from '../game/board'
import { getStateAtPly } from '../game/model'
import { applyGameResult } from '../game/rating'
import { DIFFICULTY_LABELS } from './constants'

/**
 * 终局棋力分结算。
 * 难度取 header.Difficulty（v1.2 起写入）；
 * 旧棋谱按对手名回推；残局/导入等非人机对局返回 null 不计分。
 */
export function settleRating(game: Game): LastRatingChange | null {
  const isRedPlayer = game.header.Red === '玩家'
  const isBlackPlayer = game.header.Black === '玩家'
  if (isRedPlayer === isBlackPlayer) return null

  let difficulty = game.header.Difficulty as Difficulty | undefined
  if (!difficulty || !(difficulty in DIFFICULTY_LABELS)) {
    const oppName = isRedPlayer ? game.header.Black : game.header.Red
    difficulty = (Object.entries(DIFFICULTY_LABELS) as [Difficulty, string][])
      .find(([, label]) => label === oppName)?.[0]
    if (!difficulty) return null
  }

  const outcome =
    game.result === '1/2-1/2' ? 'draw'
      : game.result === '1-0' ? (isRedPlayer ? 'win' : 'loss')
        : (isBlackPlayer ? 'win' : 'loss')

  return applyGameResult(game.id, difficulty, outcome)
}

export function boardFromGame(game: Game, plyIndex: number): BoardState {
  if (plyIndex === 0) return boardFromFen(game.startFen)
  const state = getStateAtPly(game.startFen, game.plies, plyIndex)
  return state
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function parseMoveFromUci(uci: string, turn: Turn): Move {
  return {
    from: { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) },
    to: { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) },
    turn,
  }
}

/**
 * 启动棋钟：1 秒一跳。
 * 界面只显示到秒，100ms 更新会让订阅时间的组件树以 10Hz 重渲染。
 * 返回 interval id，调用方负责 clearInterval 并写入 timerInterval。
 */
export function startGameClock(set: StoreSet, get: StoreGet): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const { mode, board, redTime, blackTime } = get()
    if (mode !== 'play') return
    if (board.turn === 'w') set({ redTime: redTime + 1000 })
    else set({ blackTime: blackTime + 1000 })
  }, 1000)
}
