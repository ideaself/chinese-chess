/**
 * 棋谱存储层
 *
 * 使用 localStorage 持久化棋谱。
 * 遵循计划文档第7.1节：每盘人机对战结束后自动保存。
 */

import type { Game } from '../game/model'

const STORAGE_KEY = 'xiangqi_games'
const SETTINGS_KEY = 'xiangqi_settings'

// ── 棋谱存储 ──────────────────────────────────────────────────────

/** 获取所有棋谱 */
export function getAllGames(): Game[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

/** 保存棋谱 */
export function saveGame(game: Game): void {
  const games = getAllGames()
  const idx = games.findIndex(g => g.id === game.id)
  if (idx >= 0) {
    games[idx] = game
  } else {
    games.unshift(game) // 新棋谱放最前面
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(games))
}

/** 删除棋谱 */
export function deleteGame(id: string): void {
  const games = getAllGames().filter(g => g.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(games))
}

/** 切换收藏 */
export function toggleStar(id: string): void {
  const games = getAllGames()
  const game = games.find(g => g.id === id)
  if (game) {
    game.starred = !game.starred
    game.updatedAt = Date.now()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games))
  }
}

/** 获取最近 N 局棋谱 */
export function getRecentGames(limit: number = 10): Game[] {
  return getAllGames().slice(0, limit)
}

/** 获取收藏棋谱 */
export function getStarredGames(): Game[] {
  return getAllGames().filter(g => g.starred)
}

/** 搜索棋谱（按对手名/日期） */
export function searchGames(query: string): Game[] {
  const q = query.toLowerCase()
  return getAllGames().filter(g => {
    return (
      (g.header.Red || '').toLowerCase().includes(q) ||
      (g.header.Black || '').toLowerCase().includes(q) ||
      (g.header.Event || '').toLowerCase().includes(q) ||
      (g.header.Date || '').includes(q)
    )
  })
}

/** 获取棋谱数量 */
export function getGameCount(): number {
  return getAllGames().length
}

// ── 设置存储 ──────────────────────────────────────────────────────

export interface AppSettings {
  // 棋盘
  boardStyle: string
  pieceStyle: string
  boardFlipped: boolean
  // 操作
  showLegalMoves: boolean
  animationEnabled: boolean
  autoPlaySpeed: number // ms per move
  // 音效
  soundMove: boolean
  soundCapture: boolean
  soundCheck: boolean
  // 对局
  defaultSide: 'w' | 'b' | 'random'
  defaultDifficulty: string
}

const DEFAULT_SETTINGS: AppSettings = {
  boardStyle: 'classic',
  pieceStyle: 'classic',
  boardFlipped: false,
  showLegalMoves: true,
  animationEnabled: true,
  autoPlaySpeed: 1000,
  soundMove: true,
  soundCapture: true,
  soundCheck: true,
  defaultSide: 'w',
  defaultDifficulty: 'medium',
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const current = getSettings()
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }))
}

// ── 战绩统计（计划第19节） ────────────────────────────────────────

export type PlayerOutcome = 'win' | 'loss' | 'draw'

export interface GameStats {
  totalGames: number
  wins: number
  losses: number
  draws: number
  /** 最近 20 局的胜负序列（玩家视角，新→旧） */
  recentResults: PlayerOutcome[]
  /** 玩家平均每步损失（厘兵，仅已整盘分析的对局） */
  avgMoveLoss: number | null
}

/** 判定一局棋中玩家的胜负（header.Red/Black === '玩家' 标记人机对局） */
function playerOutcome(g: Game): PlayerOutcome | null {
  const isRedPlayer = g.header.Red === '玩家'
  const isBlackPlayer = g.header.Black === '玩家'
  if (!isRedPlayer && !isBlackPlayer) return null // 导入/非人机对局不计入
  if (g.result === '1/2-1/2') return 'draw'
  if (g.result === '1-0') return isRedPlayer ? 'win' : 'loss'
  if (g.result === '0-1') return isBlackPlayer ? 'win' : 'loss'
  return null
}

/** 实时从棋谱库计算战绩 */
export function getStats(): GameStats {
  const games = getAllGames()
  let wins = 0, losses = 0, draws = 0
  const recentResults: PlayerOutcome[] = []

  for (const g of games) {
    const outcome = playerOutcome(g)
    if (!outcome) continue
    if (outcome === 'win') wins++
    else if (outcome === 'loss') losses++
    else draws++
    if (recentResults.length < 20) recentResults.push(outcome)
  }

  // 平均分析评价: 玩家着法的平均损失（厘兵）
  let lossSum = 0, lossCount = 0
  for (const g of games) {
    if (g.analysisStatus !== 'complete') continue
    const isRedPlayer = g.header.Red === '玩家'
    const isBlackPlayer = g.header.Black === '玩家'
    for (const ply of g.plies) {
      if (!ply.analysis) continue
      if (isRedPlayer !== isBlackPlayer && ply.turn !== (isRedPlayer ? 'w' : 'b')) continue
      lossSum += ply.analysis.moveLoss
      lossCount++
    }
  }

  return {
    totalGames: wins + losses + draws,
    wins, losses, draws,
    recentResults,
    avgMoveLoss: lossCount > 0 ? lossSum / lossCount : null,
  }
}

// ── 错题本（计划第17节 V2） ───────────────────────────────────────

const MASTERED_KEY = 'xiangqi_mastered'

export interface MistakeItem {
  gameId: string
  gameDate: number
  /** 失误着法的 Ply 序号（0-based） */
  plyIndex: number
  round: number
  moveCn: string
  bestMoveCn: string
  classification: string
  moveLoss: number
  /** 去重/掌握度键（局面+着法，忽略计数器） */
  key: string
}

/** 已掌握错题键集合 */
export function getMasteredKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(MASTERED_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {}
  return new Set()
}

/** 切换某题的"已掌握"状态 */
export function toggleMastered(key: string): void {
  const keys = getMasteredKeys()
  if (keys.has(key)) keys.delete(key)
  else keys.add(key)
  localStorage.setItem(MASTERED_KEY, JSON.stringify([...keys]))
}

/** 从已分析棋谱中提取玩家的失误局面（新→旧，同局面同着法去重，最多 50 条） */
export function getMistakes(): MistakeItem[] {
  const ERROR_LEVELS = new Set(['mistake', 'blunder', 'blunder2'])
  const items: MistakeItem[] = []
  const seen = new Set<string>()

  const games = [...getAllGames()].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const g of games) {
    if (g.analysisStatus !== 'complete') continue
    const isRedPlayer = g.header.Red === '玩家'
    const isBlackPlayer = g.header.Black === '玩家'
    if (isRedPlayer === isBlackPlayer) continue // 非人机对局不计入
    const playerTurn = isRedPlayer ? 'w' : 'b'

    for (let i = 0; i < g.plies.length; i++) {
      const ply = g.plies[i]
      if (!ply.analysis || ply.turn !== playerTurn) continue
      if (!ERROR_LEVELS.has(ply.analysis.classification)) continue

      // 去重键：局面（棋盘+行棋方，忽略计数器）+ 着法
      const posKey = ply.fenBefore.split(' ').slice(0, 2).join(' ')
      const dedupKey = `${posKey}|${ply.move}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)

      items.push({
        gameId: g.id,
        gameDate: g.updatedAt,
        plyIndex: i,
        round: Math.floor(i / 2) + 1,
        moveCn: ply.moveCn,
        bestMoveCn: ply.analysis.bestMoveCn || '',
        classification: ply.analysis.classification,
        moveLoss: ply.analysis.moveLoss,
        key: dedupKey,
      })
      if (items.length >= 50) return items
    }
  }
  return items
}

// ── 个人弱点分析（计划第19节 V2 / 第26节 A） ──────────────────────

type Phase = 'opening' | 'middle' | 'endgame'

interface PhaseStat {
  /** 该阶段玩家着法数 */
  plies: number
  /** 损失合计（厘兵） */
  lossSum: number
  /** 明显失误数 */
  errors: number
}

export interface WeaknessAnalysis {
  opening: PhaseStat
  middle: PhaseStat
  endgame: PhaseStat
  /** 样本充足时损失最高的阶段 */
  weakestPhase: Phase | null
}

function phaseOf(plyIndex: number, piecesOnBoard: number): Phase {
  if (piecesOnBoard <= 12) return 'endgame'
  if (plyIndex < 10) return 'opening'
  return 'middle'
}

function emptyPhase(): PhaseStat {
  return { plies: 0, lossSum: 0, errors: 0 }
}

/** 按开局/中局/残局聚合玩家着法质量 */
export function getWeaknessAnalysis(): WeaknessAnalysis | null {
  const ERROR_LEVELS = new Set(['mistake', 'blunder', 'blunder2'])
  const result: WeaknessAnalysis = {
    opening: emptyPhase(),
    middle: emptyPhase(),
    endgame: emptyPhase(),
    weakestPhase: null,
  }

  let samples = 0
  for (const g of getAllGames()) {
    if (g.analysisStatus !== 'complete') continue
    const isRedPlayer = g.header.Red === '玩家'
    const isBlackPlayer = g.header.Black === '玩家'
    if (isRedPlayer === isBlackPlayer) continue
    const playerTurn = isRedPlayer ? 'w' : 'b'

    for (let i = 0; i < g.plies.length; i++) {
      const ply = g.plies[i]
      if (!ply.analysis || ply.turn !== playerTurn) continue
      const pieces = ply.fenBefore.split(' ')[0].replace(/[^a-zA-Z]/g, '').length
      const stat = result[phaseOf(i, pieces)]
      stat.plies++
      stat.lossSum += ply.analysis.moveLoss
      if (ERROR_LEVELS.has(ply.analysis.classification)) stat.errors++
      samples++
    }
  }

  if (samples < 10) return null

  // 找样本 ≥5 且平均损失最高的阶段
  let worst: Phase | null = null
  let worstAvg = -1
  for (const phase of ['opening', 'middle', 'endgame'] as Phase[]) {
    const s = result[phase]
    if (s.plies < 5) continue
    const avg = s.lossSum / s.plies
    if (avg > worstAvg) { worstAvg = avg; worst = phase }
  }
  result.weakestPhase = worst
  return result
}
