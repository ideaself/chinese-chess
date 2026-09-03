/**
 * AI 自然语言总结 - 计划第18节
 *
 * 引擎负责评价/最佳着法/变化/关键错误，
 * 本模块基于整盘分析数据生成人类可读的对局总结。
 * 属于分析层的上层功能，不替代引擎。
 */

import type { Game } from './model'
import { ERROR_LEVELS } from './model'

/** 局面棋子数（用于粗分残局） */
function pieceCount(fen: string): number {
  return fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length
}

export function generateGameSummary(game: Game): string[] {
  const lines: string[] = []

  const analyzedPlies = game.plies.filter(p => p.analysis)
  if (analyzedPlies.length === 0) {
    return ['本局尚未进行整盘分析，先点击"整盘分析"。']
  }

  // 玩家执方（header 由 startNewGame 写入）
  const isRedPlayer = game.header.Red === '玩家'
  const isBlackPlayer = game.header.Black === '玩家'
  const playerSide: 'w' | 'b' = isBlackPlayer && !isRedPlayer ? 'b' : 'w'
  const playerName = playerSide === 'w' ? '你（红方）' : '你（黑方）'
  const oppName = playerSide === 'w' ? '黑方' : '红方'

  // ── 结果 ──
  if (game.result === '1-0') lines.push(`本局结果：红方胜。${playerSide === 'w' ? '恭喜获胜！' : '虽然落败，复盘会帮你找到改进空间。'}`)
  else if (game.result === '0-1') lines.push(`本局结果：黑方胜。${playerSide === 'b' ? '恭喜获胜！' : '虽然落败，复盘会帮你找到改进空间。'}`)
  else if (game.result === '1/2-1/2') lines.push('本局结果：双方握手言和。')
  else lines.push('本局未结束（分析基于已走的部分）。')

  // ── 开局（前 5 回合 = 10 ply）──
  const openingErrors = game.plies
    .slice(0, 10)
    .filter(p => p.turn === playerSide && p.analysis && ERROR_LEVELS.includes(p.analysis.classification))
  if (openingErrors.length === 0) {
    lines.push('开局阶段你发挥稳定，没有明显问题。')
  } else {
    const rounds = openingErrors.map(p => Math.floor(game.plies.indexOf(p) / 2) + 1).join('、')
    lines.push(`开局阶段有 ${openingErrors.length} 处疑问（第 ${rounds} 回合），建议对照推荐着法改进。`)
  }

  // ── 主动权转移（红方视角评估首次显著偏离 0）──
  let momentumLine: string | null = null
  for (let i = 0; i < game.plies.length; i++) {
    const a = game.plies[i].analysis
    if (!a) continue
    const evalRed = game.plies[i].turn === 'w' ? a.score : -a.score
    if (Math.abs(evalRed) >= 250) {
      const leader = evalRed > 0 ? '红方' : '黑方'
      momentumLine = `到第 ${Math.floor(i / 2) + 1} 回合为止，${leader}已取得明显主动（约 ${(Math.abs(evalRed) / 100).toFixed(1)} 兵优势）。`
      break
    }
  }
  if (momentumLine) lines.push(momentumLine)

  // ── 最大失误 ──
  const playerErrors = game.plies
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.turn === playerSide && p.analysis && ERROR_LEVELS.includes(p.analysis.classification))
    .sort((x, y) => y.p.analysis!.moveLoss - x.p.analysis!.moveLoss)

  if (playerErrors.length > 0) {
    const worst = playerErrors[0]
    const round = Math.floor(worst.i / 2) + 1
    const lossPawns = (worst.p.analysis!.moveLoss / 100).toFixed(1)
    const best = worst.p.analysis!.bestMoveCn
    lines.push(
      `第 ${round} 回合的"${worst.p.moveCn}"是本局最大失误（损失约 ${lossPawns} 兵）${best ? `，当时应走 ${best}` : ''}。`,
    )
    if (playerErrors.length >= 3) {
      lines.push(`此外还有 ${playerErrors.length - 1} 处较小失误，可在"关键时刻"中逐一查看。`)
    }
  } else {
    lines.push('整盘没有检测到你的明显失误，保持这种稳定性！')
  }

  // ── 对手表现 ──
  const oppErrors = game.plies
    .filter(p => p.turn !== playerSide && p.analysis && ERROR_LEVELS.includes(p.analysis.classification))
  if (oppErrors.length >= 2) {
    lines.push(`${oppName}也有 ${oppErrors.length} 处失误，其中一些是你扩大优势的机会。`)
  }

  // ── 残局（棋子 ≤ 12 的最后阶段）──
  let endgameStart = -1
  for (let i = game.plies.length - 1; i >= 0; i--) {
    if (pieceCount(game.plies[i].fenAfter) > 12) { endgameStart = i + 1; break }
  }
  if (endgameStart > 0 && endgameStart < game.plies.length) {
    const endgameErrors = game.plies
      .slice(endgameStart)
      .filter(p => p.turn === playerSide && p.analysis && ERROR_LEVELS.includes(p.analysis.classification))
    lines.push(endgameErrors.length === 0
      ? '残局阶段你没有明显问题。'
      : `残局阶段有 ${endgameErrors.length} 处失误，残局功力还需加强。`)
  }

  return lines
}
