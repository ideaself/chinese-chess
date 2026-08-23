#!/usr/bin/env node
/**
 * 开局书生成脚本
 *
 * 扫描 dpxq 语料，聚合前 N 步的着法频率与胜率，
 * 生成 public/opening-book.json，供对局 AI 在开局阶段选用大师实战主流着法。
 *
 * 聚合口径（红方视角）:
 *   wr = (红胜 + 0.5×和棋) / 该着法出现次数
 * 运行时按行棋方换算: 黑方用 1-wr。
 *
 * 用法:
 *   node scripts/book-gen.mjs [--src <dir>] [--out <file>]
 *        [--max-games <N>=50000] [--max-ply <N>=10] [--min-count <N>=3]
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const SRC_DIR = resolve(arg('src', join(REPO_ROOT, '..', 'chinese-chess', 'data', 'raw', 'dpxq_master')))
const OUT_FILE = resolve(arg('out', join(REPO_ROOT, 'public', 'opening-book.json')))
const MAX_GAMES = parseInt(arg('max-games', '50000'), 10)
const MAX_PLY = parseInt(arg('max-ply', '10'), 10)
const MIN_COUNT = parseInt(arg('min-count', '3'), 10)

function extractField(text, name) {
  const m = text.match(new RegExp(`\\[DhtmlXQ_${name}\\]([^\\[]*)`))
  return m ? m[1].trim() : ''
}

/** 粗校验 movelist（起点有子的盲走） */
function validMovelist(mv) {
  const len = mv.length
  if (!mv || len % 4 !== 0 || /[^0-9]/.test(mv)) return false
  const board = new Array(90).fill('.')
  const back = 'rnbakabnr'
  for (let x = 0; x < 9; x++) {
    board[x] = back[x]
    board[81 + x] = back[x].toUpperCase()
  }
  board[19] = 'c'; board[25] = 'c'; board[64] = 'C'; board[70] = 'C'
  for (let x = 0; x < 9; x += 2) { board[27 + x] = 'p'; board[54 + x] = 'P' }

  const plies = Math.min(len / 4, MAX_PLY)
  for (let i = 0; i < plies; i++) {
    const x1 = mv.charCodeAt(i * 4) - 48, y1 = mv.charCodeAt(i * 4 + 1) - 48
    const x2 = mv.charCodeAt(i * 4 + 2) - 48, y2 = mv.charCodeAt(i * 4 + 3) - 48
    if (x1 < 0 || x1 > 8 || x2 < 0 || x2 > 8 || y1 < 0 || y1 > 9 || y2 < 0 || y2 > 9) return false
    const from = y1 * 9 + x1, to = y2 * 9 + x2
    if (board[from] === '.') return false
    board[to] = board[from]
    board[from] = '.'
  }
  return true
}

/** dpxq 坐标对 → 应用 UCI（"7747" → "h2e2"，col=x, row=9-y） */
function toUci(s, i) {
  return String.fromCharCode(97 + (s.charCodeAt(i) - 48)) + (9 - (s.charCodeAt(i + 1) - 48)) +
    String.fromCharCode(97 + (s.charCodeAt(i + 2) - 48)) + (9 - (s.charCodeAt(i + 3) - 48))
}

// ── 主流程 ────────────────────────────────────────────────────────

console.log(`扫描目录: ${SRC_DIR}`)
const t0 = Date.now()

const files = readdirSync(SRC_DIR).filter(f => /^master_\d+\.txt$/.test(f)).sort()

/** positions: key(空格分隔uci序列) -> Map(move -> {n, redWin, blackWin, draw}) */
const positions = new Map()
let gamesUsed = 0

for (const f of files) {
  if (gamesUsed >= MAX_GAMES) break
  let text
  try {
    text = readFileSync(join(SRC_DIR, f), 'utf-8')
  } catch { continue }

  const mv = extractField(text, 'movelist')
  const res = extractField(text, 'result')
  if (!mv || mv.length / 4 < 16 || !validMovelist(mv)) continue
  // 结果未知的不参与胜率统计
  if (res !== '红胜' && res !== '黑胜' && res !== '和棋') continue
  gamesUsed++

  let redWin = 0, blackWin = 0, draw = 0
  if (res === '红胜') redWin = 1
  else if (res === '黑胜') blackWin = 1
  else draw = 1

  const plies = Math.min(mv.length / 4, MAX_PLY)
  for (let p = 0; p < plies; p++) {
    // 用 UCI 序列作 key（与运行时 moves 数组一致）
    const parts = []
    for (let q = 0; q < p; q++) parts.push(toUci(mv, q * 4))
    const key = parts.join(' ')
    const move = toUci(mv, p * 4)
    let m = positions.get(key)
    if (!m) { m = new Map(); positions.set(key, m) }
    let s = m.get(move)
    if (!s) { s = { n: 0, redWin: 0, blackWin: 0, draw: 0 }; m.set(move, s) }
    s.n++; s.redWin += redWin; s.blackWin += blackWin; s.draw += draw
  }
}

// ── 选线输出：每个局面保留行棋方视角最优的前 3 着 ────────────────

const outPositions = {}
let totalMoves = 0
for (const [key, movesMap] of positions) {
  const ply = key ? key.split(' ').length : 0
  const redToMove = ply % 2 === 0

  const cands = []
  for (const [move, s] of movesMap) {
    if (s.n < MIN_COUNT) continue
    const wr = (s.redWin + 0.5 * s.draw) / s.n // 红方视角得分率
    cands.push({ move, n: s.n, wr, moverScore: redToMove ? wr : 1 - wr })
  }

  if (cands.length === 0) continue
  // 按行棋方视角排序；保证出现最多的主线始终入选
  cands.sort((a, b) => b.moverScore - a.moverScore)
  const kept = []
  const mainline = cands.reduce((a, b) => (a.n >= b.n ? a : b))
  if (!kept.includes(mainline)) kept.push(mainline)
  for (const c of cands) {
    if (kept.length >= 3) break
    if (c === mainline) continue
    if (c.moverScore < 0.45) continue // 过差的着法不入库
    kept.push(c)
  }

  outPositions[key] = kept.map(c => ({ m: c.move, n: c.n, wr: Math.round(c.wr * 1000) / 1000 }))
  totalMoves += kept.length
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'dpxq.com 东萍象棋网',
  games: gamesUsed,
  maxPly: MAX_PLY,
  minCount: MIN_COUNT,
  positions: outPositions,
}

writeFileSync(OUT_FILE, JSON.stringify(payload))
const sizeKB = Math.round(JSON.stringify(payload).length / 1024)
console.log(`完成: 使用 ${gamesUsed} 局 · 局面 ${Object.keys(outPositions).length} 个 · 候选着法 ${totalMoves} 条`)
console.log(`输出: ${OUT_FILE} (${sizeKB} KB) · 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
