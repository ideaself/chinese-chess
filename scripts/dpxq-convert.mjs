#!/usr/bin/env node
/**
 * dpxq_master 棋谱转换脚本
 *
 * 将东萍 DhtmlXQ 原始文件转换为应用棋谱库的精简 JSON
 * （public/master-games.json），供「大师棋谱库」按需加载。
 *
 * 特性:
 *   - 无需完整规则引擎：盲走校验（起点必须有子）过滤损坏记录
 *   - 统计每局残局阶段长度，为「残局」分类提供标签
 *   - 无状态全量扫描，可反复执行；下载新增文件后重跑即可增量入库
 *
 * 用法:
 *   node scripts/dpxq-convert.mjs [--src <dir>] [--out <file>]
 *        [--max <N>=3000] [--min-plies <N>=16]
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
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
const OUT_FILE = resolve(arg('out', join(REPO_ROOT, 'public', 'master-games.json')))
const MAX_GAMES = parseInt(arg('max', '3000'), 10)
const MIN_PLIES = parseInt(arg('min-plies', '16'), 10)

// ── 盲走棋盘（仅用于合法性粗筛与子力统计） ────────────────────────

// 初始布局，行序 y=0(顶)→y=9(底)，与 START_FEN 一致
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

/** 解析单个文件的 movelist；返回 {mv, eg} 或 null */
function convertMovelist(mv) {
  const len = mv.length
  if (!mv || len % 4 !== 0 || /[^0-9]/.test(mv)) return null
  const plies = len / 4
  if (plies < MIN_PLIES) return null // 过短视为无效/残缺棋谱

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
    if ((i / 4) % 2 === 1 && countPieces() <= 11) endgamePlies++ // 每回合末统计
  }

  return { mv, eg: endgamePlies }
}

function extractField(text, name) {
  const m = text.match(new RegExp(`\\[DhtmlXQ_${name}\\]([^\\[]*)`))
  return m ? m[1].trim() : ''
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

const records = []
let scanned = 0, invalid = 0, short = 0, dupIds = new Set()
let stopScan = false

for (const f of files) {
  if (stopScan) break
  scanned++
  let text
  try {
    text = readFileSync(join(SRC_DIR, f), 'utf-8')
  } catch { invalid++; continue }

  const mvRaw = extractField(text, 'movelist')
  if (!mvRaw) { invalid++; continue }
  if (mvRaw.length / 4 < MIN_PLIES) { short++; continue }

  const converted = convertMovelist(mvRaw)
  if (!converted) { invalid++; continue }

  const id = parseInt(extractField(text, 'gameid') || '0', 10)
  if (dupIds.has(id)) continue
  dupIds.add(id)

  records.push({
    id,
    t: extractField(text, 'title') || undefined,
    e: extractField(text, 'event') || undefined,
    d: extractField(text, 'date') || undefined,
    r: extractField(text, 'red') || undefined,
    b: extractField(text, 'black') || undefined,
    res: extractField(text, 'result') || undefined,
    ...converted,
  })

  if (records.length >= MAX_GAMES) stopScan = true
}

records.sort((a, b) => a.id - b.id)

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'dpxq.com 东萍象棋网',
  count: records.length,
  games: records,
}

mkdirSync(dirname(OUT_FILE), { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(payload))

const sizeMB = (JSON.stringify(payload).length / 1024 / 1024).toFixed(1)
console.log(`完成: 扫描 ${scanned} 文件 → 收录 ${records.length} 局`)
console.log(`  跳过: 无效 ${invalid} · 过短(<${MIN_PLIES}步) ${short}${stopScan ? ' · 达到上限停止扫描' : ''}`)
console.log(`  残局丰富(残局阶段≥30步): ${records.filter(r => r.eg >= 30).length} 局`)
console.log(`输出: ${OUT_FILE} (${sizeMB} MB) · 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
