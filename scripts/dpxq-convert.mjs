#!/usr/bin/env node
/**
 * dpxq_master 棋谱转换脚本（增量缓存 + 分片输出）
 *
 * 将东萍 DhtmlXQ 原始文件转换为应用棋谱库的精简 JSON 分片，
 * 输出到 public/master-games/（manifest.json + shard_N.json），
 * 供「大师棋谱库」按需分片加载。
 *
 * 特性:
 *   - mtime 增量缓存：未变化的文件不重复解析，语料增长后重跑秒级完成
 *   - 无需完整规则引擎：盲走校验（起点必须有子）过滤损坏记录
 *   - 统计每局残局阶段长度，为「残局」分类提供标签
 *   - 输出按 id 排序分片，前端逐片懒加载
 *
 * 用法:
 *   node scripts/dpxq-convert.mjs [--src <dir>] [--out-dir <dir>]
 *        [--max <N>=3000] [--min-plies <N>=16] [--shard <N>=1000] [--no-famous]
 *
 * 默认名家优先: 全量扫描语料，含名家棋手的对局排前，取前 --max 局；
 * --no-famous 恢复旧的按文件顺序取前 N 局行为。
 */

import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ── 参数 ──────────────────────────────────────────────────────────

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const SRC_DIR = resolve(arg('src', join(REPO_ROOT, '..', 'chinese-chess', 'data', 'raw', 'dpxq_master')))
const OUT_DIR = resolve(arg('out-dir', join(REPO_ROOT, 'public', 'master-games')))
const MAX_GAMES = parseInt(arg('max', '3000'), 10)
const MIN_PLIES = parseInt(arg('min-plies', '16'), 10)
const SHARD_SIZE = parseInt(arg('shard', '1000'), 10)
const NO_FAMOUS = process.argv.includes('--no-famous')

// 名家名单（跨代特级大师/全国冠军为主，按姓名子串匹配红黑方任一方）
const FAMOUS_PLAYERS = [
  // 老一辈名家
  '杨官璘', '李义庭', '何顺安', '朱剑秋', '董文渊', '陈松顺', '刘忆慈',
  '王嘉良', '屠景明', '侯玉山', '张德魁', '谢小然', '罗天扬', '窦国柱',
  '徐天利', '臧如意', '钱洪发', '刘殿中', '孟立国', '蔡福如', '陈孝堃',
  // 全国冠军/特级大师
  '胡荣华', '柳大华', '李来群', '赵国荣', '吕钦', '许银川', '徐天红',
  '陶汉明', '于幼华', '洪智', '赵鑫鑫', '蒋川', '孙勇征', '谢靖',
  '徐超', '王廓', '王天一', '郑惟桐',
  // 特级/强大师
  '孟辰', '汪洋', '王跃飞', '苗永鹏', '林宏敏', '徐建明', '卜凤波',
  '傅光明', '宋国强', '张强', '聂铁文', '黄仕清', '尚威', '金波',
  // 新生代
  '王禹博', '孟繁睿', '许文章', '赵攀伟', '莫梓健', '尹昇',
  // 女子名家
  '唐丹', '王琳娜', '张国凤', '金海英', '陈丽淳', '赵冠芳',
]

function isFamousGame(rec) {
  return FAMOUS_PLAYERS.some(n => (rec.r || '').includes(n) || (rec.b || '').includes(n))
}

const STATE_FILE = join(OUT_DIR, 'state.json')

// ── 盲走棋盘（仅用于合法性粗筛与子力统计） ────────────────────────

function initialBoard() {
  const b = new Array(90).fill('.')
  const back = 'rnbakabnr'
  for (let x = 0; x < 9; x++) {
    b[0 * 9 + x] = back[x]
    b[9 * 9 + x] = back[x].toUpperCase()
  }
  b[2 * 9 + 1] = 'c'; b[2 * 9 + 7] = 'c'
  b[7 * 9 + 1] = 'C'; b[7 * 9 + 7] = 'C'
  for (let x = 0; x < 9; x += 2) {
    b[3 * 9 + x] = 'p'
    b[6 * 9 + x] = 'P'
  }
  return b
}

/** 解析 movelist；返回 {mv, eg} 或 null */
function convertMovelist(mv) {
  const len = mv.length
  if (!mv || len % 4 !== 0 || /[^0-9]/.test(mv)) return null
  const plies = len / 4
  if (plies < MIN_PLIES) return null

  const board = initialBoard()
  let endgamePlies = 0

  const countPieces = () => {
    let n = 0
    for (let i = 0; i < 90; i++) if (board[i] !== '.') n++
    return n
  }

  for (let i = 0; i < len; i += 4) {
    const x1 = mv.charCodeAt(i) - 48, y1 = mv.charCodeAt(i + 1) - 48
    const x2 = mv.charCodeAt(i + 2) - 48, y2 = mv.charCodeAt(i + 3) - 48
    if (x1 < 0 || x1 > 8 || x2 < 0 || x2 > 8 || y1 < 0 || y1 > 9 || y2 < 0 || y2 > 9) return null
    const from = y1 * 9 + x1, to = y2 * 9 + x2
    const piece = board[from]
    if (piece === '.') return null // 起点无子 → 记录损坏
    board[to] = piece
    board[from] = '.'
    if ((i / 4) % 2 === 1 && countPieces() <= 11) endgamePlies++
  }

  return { mv, eg: endgamePlies }
}

function extractField(text, name) {
  const m = text.match(new RegExp(`\\[DhtmlXQ_${name}\\]([^\\[]*)`))
  return m ? m[1].trim() : ''
}

/** dpxq 坐标串 → 应用 UCI 串（每 4 字符一组，col=x, row=9-y） */
function toUciMv(mv) {
  let out = ''
  for (let i = 0; i < mv.length; i += 4) {
    out += String.fromCharCode(97 + (mv.charCodeAt(i) - 48)) + (9 - (mv.charCodeAt(i + 1) - 48)) +
      String.fromCharCode(97 + (mv.charCodeAt(i + 2) - 48)) + (9 - (mv.charCodeAt(i + 3) - 48))
  }
  return out
}

function parseFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return null
  }
  const mvRaw = extractField(text, 'movelist')
  if (!mvRaw) return null
  if (mvRaw.length / 4 < MIN_PLIES) return null
  const converted = convertMovelist(mvRaw)
  if (!converted) return null

  return {
    id: parseInt(extractField(text, 'gameid') || '0', 10),
    t: extractField(text, 'title') || undefined,
    e: extractField(text, 'event') || undefined,
    d: extractField(text, 'date') || undefined,
    r: extractField(text, 'red') || undefined,
    b: extractField(text, 'black') || undefined,
    res: extractField(text, 'result') || undefined,
    mv: toUciMv(converted.mv), // 统一输出 UCI，供分类器与对局构建直接使用
    eg: converted.eg,
  }
}

// ── 主流程 ────────────────────────────────────────────────────────

console.log(`扫描目录: ${SRC_DIR}`)
const t0 = Date.now()

let files
try {
  files = readdirSync(SRC_DIR).filter(f => /^master_\d+\.txt$/.test(f)).sort()
} catch (e) {
  console.error(`无法读取目录: ${e.message}`)
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })

// 增量状态：{ v, files: { [文件名]: { mtime, size, rec } } }
// v=2: rec.mv 为 UCI 格式（v1 为 dpxq 坐标，不兼容则弃用缓存）
const STATE_VERSION = 2
let state = null
try {
  const raw = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  if (raw && raw.v === STATE_VERSION) state = raw
} catch { /* 首次运行 */ }
if (!state) state = { v: STATE_VERSION, files: {} }

const records = []
let scanned = 0, fromCache = 0, reparsed = 0, invalid = 0, dupIds = new Set(), dupGames = 0
let stopScan = false

// 同一棋谱可能以不同 gameid 重复收录，按 movelist 去重
const mvSeen = new Set()

for (const f of files) {
  if (stopScan) break
  scanned++

  const path = join(SRC_DIR, f)
  let mtime = 0, size = 0
  try {
    const stt = statSync(path)
    mtime = Math.floor(stt.mtimeMs)
    size = stt.size
  } catch { continue }

  const cached = state.files[f]
  let rec
  if (cached && cached.mtime === mtime && cached.size === size && 'rec' in cached) {
    rec = cached.rec // 未变化，直接用缓存
    fromCache++
  } else {
    rec = parseFile(path)
    state.files[f] = { mtime, size, rec }
    reparsed++
  }

  if (!rec) { invalid++; continue }
  if (dupIds.has(rec.id)) continue
  if (mvSeen.has(rec.mv)) { dupGames++; continue }
  dupIds.add(rec.id)
  mvSeen.add(rec.mv)
  records.push(rec)

  // 名家模式需全量扫描后排序截取；仅旧顺序模式可提前停止
  if (NO_FAMOUS && records.length >= MAX_GAMES) stopScan = true
}

// 名家优先: 全量收集后按名家局排前（同组内按 id 升序），截取前 MAX_GAMES 局
let famousCount = 0
if (!NO_FAMOUS) {
  records.sort((a, b) => (isFamousGame(b) ? 1 : 0) - (isFamousGame(a) ? 1 : 0) || a.id - b.id)
  if (records.length > MAX_GAMES) records.length = MAX_GAMES
  famousCount = records.filter(isFamousGame).length
} else {
  if (records.length > MAX_GAMES) records.length = MAX_GAMES
}

records.sort((a, b) => a.id - b.id)

// ── 写入分片 ──────────────────────────────────────────────────────

// 清理旧分片（数量可能变少）
for (const f of readdirSync(OUT_DIR)) {
  if (/^shard_\d+\.json$/.test(f)) rmSync(join(OUT_DIR, f))
}

const shards = []
for (let i = 0; i < records.length; i += SHARD_SIZE) {
  const name = `shard_${shards.length}.json`
  writeFileSync(join(OUT_DIR, name), JSON.stringify(records.slice(i, i + SHARD_SIZE)))
  shards.push(name)
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'dpxq.com 东萍象棋网',
  total: records.length,
  shardSize: SHARD_SIZE,
  shards,
}
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest))
writeFileSync(STATE_FILE, JSON.stringify(state))

console.log(`完成: 扫描 ${scanned} 文件（缓存命中 ${fromCache} · 重新解析 ${reparsed}）→ 收录 ${records.length} 局${!NO_FAMOUS ? ` · 名家局 ${famousCount}` : ''}`)
console.log(`  跳过: 无效 ${invalid} · 重复棋谱 ${dupGames}${stopScan ? ' · 达到上限停止扫描' : ''}`)
console.log(`输出: ${OUT_DIR}/manifest.json + ${shards.length} 个分片`)
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
