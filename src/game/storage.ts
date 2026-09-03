/**
 * 棋谱存储层
 *
 * 使用 IndexedDB 持久化棋谱（容量远超 localStorage 的 5MB 限制），
 * 对外保持同步 API：启动时由 initGameStorage() 把数据载入内存镜像，
 * 写操作同步更新内存、异步落库。
 * 首次运行自动迁移 localStorage 中的旧棋谱。
 * 遵循计划文档第7.1节：每盘人机对战结束后自动保存。
 */

import type { Game } from '../game/model'
import { ERROR_LEVELS } from '../game/model'
import { importRatingState } from './rating'

const STORAGE_KEY = 'xiangqi_games'
const SETTINGS_KEY = 'xiangqi_settings'

// ── IndexedDB 基础 ────────────────────────────────────────────────

const DB_NAME = 'xiangqi'
const DB_VERSION = 2
const GAMES_STORE = 'games'
const MASTER_ANALYSIS_STORE = 'master_analysis'

let dbPromise: Promise<IDBDatabase> | null = null
/** 内存镜像；initGameStorage 后可用 */
let memoryGames: Game[] | null = null
/** 容量配额（init 时通过 storage.estimate 校正） */
let quotaBytes = 250 * 1024 * 1024
/** IndexedDB 是否可用（不可用时回退 localStorage） */
let idbBroken = false

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(GAMES_STORE)) {
          db.createObjectStore(GAMES_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(MASTER_ANALYSIS_STORE)) {
          db.createObjectStore(MASTER_ANALYSIS_STORE, { keyPath: 'gameId' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
    })
  }
  return dbPromise
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'))
  })
}

async function idbPut(game: Game): Promise<void> {
  const db = await openDB()
  await reqAsPromise(db.transaction(GAMES_STORE, 'readwrite').objectStore(GAMES_STORE).put(game))
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDB()
  await reqAsPromise(db.transaction(GAMES_STORE, 'readwrite').objectStore(GAMES_STORE).delete(id))
}

async function idbLoadAll(): Promise<Game[]> {
  const db = await openDB()
  const games = await reqAsPromise<Game[]>(db.transaction(GAMES_STORE).objectStore(GAMES_STORE).getAll())
  // 新棋谱在前（与旧 localStorage unshift 行为一致）
  return games.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 旧 localStorage 数据读取（迁移源 / IDB 不可用时的回退） */
function readLegacy(): Game[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const games = JSON.parse(raw)
    return Array.isArray(games) ? games : []
  } catch {
    return []
  }
}

/** 内存镜像写回兜底：IDB 故障时尽量写入 localStorage */
function fallbackPersist(): void {
  if (!idbBroken) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryGames ?? []))
  } catch { /* 空间超限则放弃 */ }
}

/**
 * 初始化存储：加载数据到内存并迁移旧数据。
 * 必须在首次调用 getAllGames 前 await 完成。
 */
export async function initGameStorage(): Promise<void> {
  if (memoryGames) return
  let loaded: Game[] | null = null
  try {
    loaded = await idbLoadAll()
  } catch (e) {
    console.warn('IndexedDB 不可用，回退 localStorage:', e)
    idbBroken = true
    dbPromise = null
  }

  if (loaded && loaded.length === 0) {
    // 首次使用 IndexedDB：迁移 localStorage 旧棋谱
    const legacy = readLegacy()
    if (legacy.length > 0) {
      loaded = legacy
      try {
        const db = await openDB()
        const tx = db.transaction(GAMES_STORE, 'readwrite')
        const store = tx.objectStore(GAMES_STORE)
        for (const g of legacy) store.put(g)
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('迁移失败'))
        })
        console.log(`已从 localStorage 迁移 ${legacy.length} 局棋谱到 IndexedDB`)
      } catch (e) {
        console.warn('迁移旧棋谱失败:', e)
      }
    }
  }

  memoryGames = loaded ?? readLegacy()

  // 校正容量配额
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota && est.quota > 0) quotaBytes = est.quota
  } catch { /* 保持默认估值 */ }
}

// ── 棋谱存储（同步 API，内存镜像） ───────────────────────────────

/** 获取所有棋谱 */
export function getAllGames(): Game[] {
  return memoryGames ?? []
}

/** 保存棋谱（内存即时生效，异步落库） */
export function saveGame(game: Game): boolean {
  if (!memoryGames) memoryGames = []
  const idx = memoryGames.findIndex(g => g.id === game.id)
  if (idx >= 0) {
    memoryGames[idx] = game
  } else {
    memoryGames.unshift(game) // 新棋谱放最前面
  }
  if (!idbBroken) {
    idbPut(game).catch(e => {
      console.error('棋谱写入 IndexedDB 失败:', e)
    })
  } else {
    fallbackPersist()
  }
  return true
}

// ── 备份 / 恢复 / 容量 ────────────────────────────────────────────

const BACKUP_VERSION = 1
const FULL_BACKUP_VERSION = 2

/** 导出全部棋谱为 JSON 字符串（旧格式，仅棋谱；兼容保留） */
export function exportAllGames(): string {
  return JSON.stringify({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    games: getAllGames(),
  })
}

// ── 全量备份（棋谱 + 设置 + 拆解战绩/错题/掌握度 + 棋力分） ────────

export interface FullBackupSummary {
  games: number
  settingsMerged: boolean
  mistakes: number
  mastered: number
  ratingRestored: boolean
}

/** 两份战绩取各项最大值（累计值只增不减） */
export function mergeQuizStats(a: QuizStats, b: QuizStats): QuizStats {
  return {
    asked: Math.max(a.asked, b.asked),
    right: Math.max(a.right, b.right),
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
  }
}

/** 合并错题：按 局面+大师着法 去重，新→旧，最多 50 条 */
export function mergeQuizMistakes(current: QuizMistake[], incoming: QuizMistake[]): QuizMistake[] {
  const valid = [...incoming, ...current].filter(m => m?.fen && m?.masterUci)
  const seen = new Set<string>()
  const merged: QuizMistake[] = []
  for (const m of valid.sort((x, y) => y.date - x.date)) {
    const key = `${m.fen}|${m.masterUci}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(m)
  }
  return merged.slice(0, 50)
}

/** 导出全量备份 JSON（含设置、拆解数据与棋力分） */
export function exportFullBackup(): string {
  let rating: unknown = null
  try { rating = JSON.parse(localStorage.getItem('xiangqi_rating') || 'null') } catch { /* ignore */ }
  return JSON.stringify({
    version: FULL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    games: getAllGames(),
    settings: getSettings(),
    quizStats: getQuizStats(),
    quizMistakes: getQuizMistakes(),
    masteredKeys: [...getMasteredKeys()],
    rating,
  })
}

/**
 * 恢复全量备份（合并语义，不丢现有数据）：
 *   棋谱按 id 跳过已存在；设置项覆盖默认但保留本机新增；
 *   战绩取最大；错题/掌握度并集；棋力分取分高的一方。
 * 兼容 v1 旧格式（仅 games）。
 */
export function importFullBackup(json: string): FullBackupSummary {
  const summary: FullBackupSummary = {
    games: 0, settingsMerged: false, mistakes: 0, mastered: 0, ratingRestored: false,
  }
  try {
    const data = JSON.parse(json)
    const incoming: Game[] = Array.isArray(data) ? data : data.games

    // 棋谱（与 v1 逻辑一致）
    if (Array.isArray(incoming)) {
      if (!memoryGames) memoryGames = []
      const ids = new Set(memoryGames.map(g => g.id))
      const newIds = new Set<string>()
      for (const g of incoming) {
        if (!g?.id || !Array.isArray(g.plies)) continue
        if (ids.has(g.id)) continue
        memoryGames.unshift(g)
        ids.add(g.id)
        newIds.add(g.id)
        summary.games++
      }
      if (summary.games > 0) {
        for (const g of incoming) {
          if (!g?.id || !Array.isArray(g.plies)) continue
          if (newIds.has(g.id)) idbPut(g).catch(() => {})
        }
      }
    }

    // v2 全量段
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.settings && typeof data.settings === 'object') {
        saveSettings(data.settings)
        summary.settingsMerged = true
      }
      if (data.quizStats && typeof data.quizStats.asked === 'number') {
        saveQuizStats(mergeQuizStats(getQuizStats(), {
          asked: data.quizStats.asked | 0,
          right: data.quizStats.right | 0,
          bestStreak: data.quizStats.bestStreak | 0,
        }))
      }
      if (Array.isArray(data.quizMistakes)) {
        const merged = mergeQuizMistakes(getQuizMistakes(), data.quizMistakes)
        const added = merged.length - getQuizMistakes().length
        saveQuizMistakes(merged)
        summary.mistakes = Math.max(0, added)
      }
      if (Array.isArray(data.masteredKeys)) {
        const keys = getMasteredKeys()
        const before = keys.size
        for (const k of data.masteredKeys) if (typeof k === 'string') keys.add(k)
        localStorage.setItem(MASTERED_KEY, JSON.stringify([...keys]))
        summary.mastered = keys.size - before
      }
      if (data.rating && typeof data.rating === 'object') {
        try {
          const cur = JSON.parse(localStorage.getItem('xiangqi_rating') || '{"rating":0}')
          const pick = (data.rating.rating ?? 0) >= (cur.rating ?? 0) ? data.rating : cur
          if ((pick.rating ?? 0) > 0) {
            // rating.ts 仅类型依赖 store，无运行时循环
            importRatingState(pick)
            summary.ratingRestored = true
          }
        } catch { /* ignore */ }
      }
    }

    if (summary.games > 0 && idbBroken) fallbackPersist()
  } catch (e) {
    console.error('恢复全量备份失败:', e)
  }
  return summary
}

/**
 * 从备份恢复：按 id 合并（已存在的跳过）
 * @returns 恢复的对局数
 */
export function importAllGames(json: string): number {
  try {
    const data = JSON.parse(json)
    const incoming: Game[] = Array.isArray(data) ? data : data.games
    if (!Array.isArray(incoming)) return 0
    if (!memoryGames) memoryGames = []
    const ids = new Set(memoryGames.map(g => g.id))
    const newIds = new Set<string>()
    let added = 0
    for (const g of incoming) {
      if (!g?.id || !Array.isArray(g.plies)) continue
      if (ids.has(g.id)) continue // 已存在跳过
      memoryGames.unshift(g)
      ids.add(g.id)
      newIds.add(g.id)
      added++
    }
    if (added > 0) {
      if (!idbBroken) {
        for (const g of incoming) {
          if (!g?.id || !Array.isArray(g.plies)) continue
          if (newIds.has(g.id)) idbPut(g).catch(() => {})
        }
      } else {
        fallbackPersist()
      }
    }
    return added
  } catch (e) {
    console.error('恢复备份失败:', e)
    return 0
  }
}

/** 当前棋谱库占用估算 */
export function getStorageUsage(): { bytes: number; games: number; limitBytes: number } {
  const raw = JSON.stringify(memoryGames ?? [])
  return {
    bytes: raw.length * 2, // UTF-16 粗略估算
    games: (memoryGames ?? []).length,
    limitBytes: quotaBytes,
  }
}

/** 删除棋谱 */
export function deleteGame(id: string): void {
  memoryGames = (memoryGames ?? []).filter(g => g.id !== id)
  if (!idbBroken) {
    idbDelete(id).catch(e => console.error('删除棋谱失败:', e))
  } else {
    fallbackPersist()
  }
}

/** 切换收藏 */
export function toggleStar(id: string): void {
  const game = (memoryGames ?? []).find(g => g.id === id)
  if (game) {
    game.starred = !game.starred
    game.updatedAt = Date.now()
    // 置顶新收藏（与旧行为一致：列表按数组顺序展示）
    if (!idbBroken) {
      idbPut(game).catch(() => {})
    } else {
      fallbackPersist()
    }
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

// ── 大师局预分析缓存（异步 API，按需读写，不进内存镜像） ─────────

/** 数据格式版本（mv 格式变更时递增使旧缓存失效） */
export const MASTER_ANALYSIS_FMT = 1

/** 单个局面的引擎评估（走棋方视角） */
export interface MasterPosEval {
  score: number
  depth: number
  bestMove: string
  pv: string[]
}

/**
 * 一局大师棋谱的预分析结果。
 * evals 键为"局面序号"：i 表示第 i 手之前的局面（0 = 初始局面），
 * 同时存关键手 i 与 i+1，即可计算大师着法的 moveLoss。
 */
export interface MasterAnalysisRecord {
  gameId: string
  fmt: number
  /** 分析深度 */
  depth: number
  createdAt: number
  evals: Record<number, MasterPosEval>
}

async function maStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  if (idbBroken) throw new Error('IndexedDB 不可用')
  const db = await openDB()
  return db.transaction(MASTER_ANALYSIS_STORE, mode).objectStore(MASTER_ANALYSIS_STORE)
}

/** 读取一局的预分析缓存；无记录或存储不可用时返回 null */
export async function getMasterAnalysis(gameId: string): Promise<MasterAnalysisRecord | null> {
  try {
    const store = await maStore('readonly')
    return (await reqAsPromise(store.get(gameId))) ?? null
  } catch {
    return null
  }
}

/** 写入/合并预分析缓存；存储不可用返回 false（静默降级） */
export async function putMasterAnalysis(rec: MasterAnalysisRecord): Promise<boolean> {
  try {
    const store = await maStore('readwrite')
    await reqAsPromise(store.put(rec))
    return true
  } catch {
    return false
  }
}

/** 已有预分析缓存的 gameId 集合（批量预分析跳过用）；不可用返回空集合 */
export async function getAllMasterAnalysisIds(): Promise<Set<string>> {
  try {
    const store = await maStore('readonly')
    const keys = await reqAsPromise<IDBValidKey[]>(store.getAllKeys())
    return new Set(keys.map(String))
  } catch {
    return new Set()
  }
}

// ── 名局拆解战绩与错题 ────────────────────────────────────────────

export interface QuizStats {
  asked: number
  right: number
  bestStreak: number
}

const QUIZ_STATS_KEY = 'xiangqi_quiz_stats'
const QUIZ_MISTAKES_KEY = 'xiangqi_quiz_mistakes'

export function getQuizStats(): QuizStats {
  try {
    const raw = localStorage.getItem(QUIZ_STATS_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      return { asked: s.asked || 0, right: s.right || 0, bestStreak: s.bestStreak || 0 }
    }
  } catch { /* ignore */ }
  return { asked: 0, right: 0, bestStreak: 0 }
}

export function saveQuizStats(s: QuizStats): void {
  try {
    localStorage.setItem(QUIZ_STATS_KEY, JSON.stringify(s))
  } catch { /* ignore */ }
}

export interface QuizMistake {
  /** 提问局面 FEN */
  fen: string
  /** 行棋方 ('w' | 'b') */
  turn: 'w' | 'b'
  /** 玩家的选择（UCI） */
  playerUci?: string
  /** 大师实战着法 */
  masterUci: string
  masterMoveCn: string
  date: number
}

/** 获取拆解错题（新→旧，最多 50 条） */
export function getQuizMistakes(): QuizMistake[] {
  try {
    const raw = localStorage.getItem(QUIZ_MISTAKES_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    }
  } catch { /* ignore */ }
  return []
}

function saveQuizMistakes(list: QuizMistake[]): void {
  try {
    localStorage.setItem(QUIZ_MISTAKES_KEY, JSON.stringify(list.slice(0, 50)))
  } catch { /* ignore */ }
}

/** 记录一道拆解错题（同局面同着法去重，新题置顶） */
export function addQuizMistake(m: QuizMistake): void {
  const list = getQuizMistakes().filter(x => !(x.fen === m.fen && x.masterUci === m.masterUci))
  list.unshift({ ...m, date: Date.now() })
  saveQuizMistakes(list)
}

/** 移除一道拆解错题（AI 追认正确时回滚） */
export function removeQuizMistake(fen: string, masterUci: string): void {
  saveQuizMistakes(getQuizMistakes().filter(x => !(x.fen === fen && x.masterUci === masterUci)))
}

/** 清空拆解错题 */
export function clearQuizMistakes(): void {
  saveQuizMistakes([])
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
  // 音效与触感
  soundMove: boolean
  soundCapture: boolean
  soundCheck: boolean
  /** 吃子语音「吃」（浏览器语音合成） */
  soundCaptureVoice: boolean
  /** 将军语音「将军」（浏览器语音合成） */
  soundCheckVoice: boolean
  /** 复盘走子音效 */
  soundReplay: boolean
  /** 落子/将军震动反馈（移动端） */
  hapticEnabled: boolean
  // 对局
  defaultSide: 'w' | 'b' | 'random'
  defaultDifficulty: string
  /** 整盘分析深度档位（计划9.1）: 8 快速 / 12 标准 / 16 深度 */
  analysisDepth: number
  // 外观
  theme: 'dark' | 'light'
  /** 对战时自动评估局面（评估条） */
  autoEval: boolean
  // ── AI 教练（DeepSeek 等 OpenAI 兼容接口）──
  /** API Key，为空则 AI 教练不可用 */
  aiCoachApiKey: string
  /** 接口基础地址；默认走开发代理 /ai-proxy */
  aiCoachBaseUrl: string
  /** 模型名 */
  aiCoachModel: string
  // ── 云同步（WebDAV，坚果云等）──
  /** WebDAV 地址（目录），如 https://dav.jianguoyun.com/dav/xiangqi */
  webdavUrl: string
  /** WebDAV 账号 */
  webdavUser: string
  /** WebDAV 密码/应用密码 */
  webdavPassword: string
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
  soundCaptureVoice: true,
  soundCheckVoice: true,
  soundReplay: true,
  hapticEnabled: true,
  defaultSide: 'w',
  defaultDifficulty: 'medium',
  analysisDepth: 16,
  theme: 'dark',
  autoEval: true,
  aiCoachApiKey: '',
  aiCoachBaseUrl: '/ai-proxy',
  aiCoachModel: 'deepseek-chat',
  webdavUrl: '',
  webdavUser: '',
  webdavPassword: '',
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
      if (!ERROR_LEVELS.includes(ply.analysis.classification)) continue

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
      if (ERROR_LEVELS.includes(ply.analysis.classification)) stat.errors++
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
