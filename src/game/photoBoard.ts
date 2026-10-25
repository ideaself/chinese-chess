/**
 * 拍照摆棋：透视校正 + 棋子识别
 *
 * 全离线、纯前端。流程：
 *   照片 → 用户拖四角 → warpBoard 拉正成 540×600 标准棋盘图
 *   → 每格检测「有无棋子」→ 判红黑 → 与内置字形模板匹配出兵种
 *   → 返回 9×10 识别结果（带置信度），交给摆棋手动修正
 *
 * 这里的函数尽量不碰 DOM（ImageData 进、ImageData 出），便于单测。
 */

import type { PieceChar, Turn } from './board'
import { createEmptyBoard } from './board'

export interface Pt { x: number; y: number }
/** 照片上棋盘的四个角：左上、右上、右下、左下 */
export type Corners = [Pt, Pt, Pt, Pt]

/** 标准棋盘图尺寸（与 Board 的 60px 格一致） */
export const BOARD_IMG_W = 540
export const BOARD_IMG_H = 600
export const GRID_CELL = 60
export const GRID_PAD = 30

export interface RecognizedCell {
  piece: PieceChar | null
  /** 0~1，越低越需要人工确认 */
  confidence: number
}

export interface RecognizedBoard {
  /** cells[row * 9 + col]（row 0 = 黑方底线） */
  cells: RecognizedCell[]
  count: number
}

// ── 透视变换 ──────────────────────────────────────────────────────

/**
 * 求 3×3 单应矩阵 H（9 个数，h33=1），满足 dst = H · src。
 * 四组对应点即可解出；退化时返回 null。
 */
export function solveHomography(src: Pt[], dst: Pt[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  }
  return gaussianSolve(A, b)
}

/** 高斯消元（部分主元），A 会被原地修改 */
function gaussianSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    }
    if (Math.abs(A[pivot][col]) < 1e-9) return null
    if (pivot !== col) {
      const tmp = A[col]; A[col] = A[pivot]; A[pivot] = tmp
      const t = b[col]; b[col] = b[pivot]; b[pivot] = t
    }
    const div = A[col][col]
    for (let c = col; c < n; c++) A[col][c] /= div
    b[col] /= div
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col]
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  return b
}

export function applyHomography(h: number[], p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + 1
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  }
}

/**
 * 把照片按四角拉正成标准棋盘图。
 * 用逆映射 + 双线性采样，避免 Canvas 只能仿射的限制。
 */
export function warpBoard(
  source: ImageData,
  corners: Corners,
  outW = BOARD_IMG_W,
  outH = BOARD_IMG_H,
  inset = GRID_PAD,
): ImageData {
  const srcW = source.width
  const srcH = source.height
  const out = new ImageData(outW, outH)
  // 用户拖的是棋盘格线外角：把它映射到内缩 inset 的格线矩形，
  // 这样每个交叉点正好落在 GRID_PAD + c/row * CELL 上，字形取样不会偏移。
  const h = solveHomography(
    [
      { x: inset, y: inset },
      { x: outW - inset, y: inset },
      { x: outW - inset, y: outH - inset },
      { x: inset, y: outH - inset },
    ],
    corners,
  )
  if (!h) return out
  const sd = source.data
  const od = out.data
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(h, { x, y })
      sampleBilinear(sd, srcW, srcH, p.x, p.y, od, (y * outW + x) * 4)
    }
  }
  return out
}

function sampleBilinear(
  src: Uint8ClampedArray, w: number, h: number,
  x: number, y: number, dst: Uint8ClampedArray, di: number,
): void {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
    const cx = Math.max(0, Math.min(w - 1, Math.round(x)))
    const cy = Math.max(0, Math.min(h - 1, Math.round(y)))
    const si = (cy * w + cx) * 4
    dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255
    return
  }
  const fx = x - x0
  const fy = y - y0
  const i00 = (y0 * w + x0) * 4
  const i10 = i00 + 4
  const i01 = i00 + w * 4
  const i11 = i01 + 4
  for (let k = 0; k < 3; k++) {
    const a = src[i00 + k] * (1 - fx) + src[i10 + k] * fx
    const b = src[i01 + k] * (1 - fx) + src[i11 + k] * fx
    dst[di + k] = a * (1 - fy) + b * fy
  }
  dst[di + 3] = 255
}

// ── 棋盘格识别 ────────────────────────────────────────────────────

const CELL_R = 24
/** 字形采样窗口（32×32），归一化到 16×16 后比对，消除字号/位置差异 */
const MASK_N = 40
const NORM_N = 24
const GLYPHS_RED = ['车', '马', '炮', '相', '仕', '帅', '兵'] as const
const GLYPHS_BLACK = ['车', '马', '炮', '象', '士', '将', '卒'] as const
const GLYPHS_ALL = ['车', '马', '炮', '相', '仕', '帅', '兵', '象', '士', '将', '卒'] as const
const PIECE_RED = ['R', 'N', 'C', 'B', 'A', 'K', 'P']
const PIECE_BLACK = ['r', 'n', 'c', 'b', 'a', 'k', 'p']

/** 多字体模板：楷体/宋体/黑体各渲一份，物理棋子字体不确定时取最好的匹配 */
const FONTS = [
  '"KaiTi","STKaiti","Kaiti SC","Noto Serif CJK SC",serif',
  '"SimSun","Songti SC","Noto Serif CJK SC",serif',
  '"Noto Sans CJK SC","Microsoft YaHei",sans-serif',
]

let templateCache: Record<string, Uint8Array[]> | null = null

/** 渲染 7 个字形模板（每个字体一份，已归一化）；无 DOM 时返回空 */
function glyphTemplates(): Record<string, Uint8Array[]> {
  if (templateCache) return templateCache
  const out: Record<string, Uint8Array[]> = {}
  if (typeof document === 'undefined') return (templateCache = out)
  const canvas = document.createElement('canvas')
  canvas.width = MASK_N
  canvas.height = MASK_N
  const ctx = canvas.getContext('2d')
  if (!ctx) return (templateCache = out)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#000'
  for (const g of GLYPHS_ALL) {
    out[g] = FONTS.map(font => {
      ctx.clearRect(0, 0, MASK_N, MASK_N)
      ctx.font = `30px ${font}`
      ctx.fillText(g, MASK_N / 2, MASK_N / 2 + 1)
      const d = ctx.getImageData(0, 0, MASK_N, MASK_N).data
      const mask = new Uint8Array(MASK_N * MASK_N)
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 80 ? 1 : 0
      return normalizeMask(mask)
    })
  }
  templateCache = out
  return out
}

/** 裁到墨迹包围盒再重采样成 16×16，抵消字号/笔画粗细/位置差异 */
function normalizeMask(mask: Uint8Array): Uint8Array {
  let x0 = MASK_N, y0 = MASK_N, x1 = -1, y1 = -1
  for (let y = 0; y < MASK_N; y++) {
    for (let x = 0; x < MASK_N; x++) {
      if (!mask[y * MASK_N + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  const out = new Uint8Array(NORM_N * NORM_N)
  if (x1 < x0 || y1 < y0) return out
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  for (let oy = 0; oy < NORM_N; oy++) {
    for (let ox = 0; ox < NORM_N; ox++) {
      const sx0 = x0 + Math.floor((ox * w) / NORM_N)
      const sx1 = x0 + Math.max(sx0 + 1, Math.floor(((ox + 1) * w) / NORM_N))
      const sy0 = y0 + Math.floor((oy * h) / NORM_N)
      const sy1 = y0 + Math.max(sy0 + 1, Math.floor(((oy + 1) * h) / NORM_N))
      let hit = 0
      let total = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          total++
          if (mask[sy * MASK_N + sx]) hit++
        }
      }
      out[oy * NORM_N + ox] = total && hit / total >= 0.4 ? 1 : 0
    }
  }
  return out
}

/** Dice 系数（比 IoU 对细笔画更宽容） */
function dice(a: Uint8Array, b: Uint8Array): number {
  let inter = 0
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++
    sum += a[i] + b[i]
  }
  return sum ? (2 * inter) / sum : 0
}

/** 求灰度图（0~255） */
function grayscale(img: ImageData): Float32Array {
  const g = new Float32Array(img.width * img.height)
  for (let i = 0; i < g.length; i++) {
    const p = i * 4
    g[i] = img.data[p] * 0.299 + img.data[p + 1] * 0.587 + img.data[p + 2] * 0.114
  }
  return g
}

interface CellStat { occ: number; ink: number; edge: number; red: number; color: number }

/** 棋盘底色亮度（整幅中位数，木色/纸色占绝大部分） */
function boardBackground(gray: Float32Array): number {
  const sample: number[] = []
  for (let i = 0; i < gray.length; i += 7) sample.push(gray[i])
  sample.sort((a, b) => a - b)
  return sample[sample.length >> 1] ?? 128
}

/**
 * 统计一个格子：
 * - occ：与棋盘底色的差异比例（判断有没有棋子，棋子是整块浅色圆盘，区分度大）
 * - ink：与格子自身中位色的差异比例（判断字形墨迹）
 */
function cellStat(gray: Float32Array, img: ImageData, cx: number, cy: number, bg: number): CellStat {
  const w = img.width
  const vals: number[] = []
  for (let dy = -CELL_R; dy <= CELL_R; dy++) {
    for (let dx = -CELL_R; dx <= CELL_R; dx++) {
      if (dx * dx + dy * dy > CELL_R * CELL_R) continue
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      vals.push(gray[y * w + x])
    }
  }
  if (!vals.length) return { occ: 0, ink: 0, edge: 0, red: 0, color: 128 }
  const sorted = vals.slice().sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  let occ = 0
  let ink = 0
  let edge = 0
  let red = 0
  for (let dy = -CELL_R; dy <= CELL_R; dy++) {
    for (let dx = -CELL_R; dx <= CELL_R; dx++) {
      if (dx * dx + dy * dy > CELL_R * CELL_R) continue
      const x = cx + dx, y = cy + dy
      if (x < 1 || y < 1 || x >= img.width - 1 || y >= img.height - 1) continue
      const v = gray[y * w + x]
      if (Math.abs(v - bg) > 32) occ++
      if (Math.abs(v - median) > 34) {
        ink++
        const p = (y * w + x) * 4
        const r = img.data[p], gg = img.data[p + 1], b = img.data[p + 2]
        if (r - gg > 26 && r - b > 26) red++
      }
      const gx = Math.abs(gray[y * w + x + 1] - gray[y * w + x - 1])
      const gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x])
      if (gx + gy > 70) edge++
    }
  }
  const area = Math.PI * CELL_R * CELL_R
  return {
    occ: occ / area,
    ink: ink / area,
    edge: edge / area,
    red: ink > 0 ? red / ink : 0,
    color: median,
  }
}

export interface RecognizedResult {
  cells: RecognizedCell[]
  /** 9×10 棋盘（col×row），可直接喂给摆棋 */
  grid: PieceChar[][]
  count: number
}

/**
 * 识别拉正后的棋盘图。
 * `occupiedThreshold` 可调（默认 0.16）：墨迹/边缘比例超过它的格子认为有棋子。
 */
export function recognizeBoard(
  warped: ImageData,
  occupiedThreshold = 0.3,
): RecognizedResult {
  const gray = grayscale(warped)
  const bg = boardBackground(gray)
  const templates = glyphTemplates()
  const cells: RecognizedCell[] = []
  const grid = createEmptyBoard()

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const cx = GRID_PAD + c * GRID_CELL
      const cy = GRID_PAD + r * GRID_CELL
      const stat = cellStat(gray, warped, cx, cy, bg)
      // 棋子是整块浅色/深色圆盘，与棋盘底色的差异面积远大于空格的格线
      if (stat.occ < occupiedThreshold) {
        cells.push({ piece: null, confidence: 1 })
        continue
      }
      const isRed = stat.red > 0.3
      const idx = cells.length
      cells.push({ piece: null, confidence: 0 })
      // 字形掩码：中心 40×40 环形取样（避开棋子圆边），裁包围盒归一化后与模板比对
      const raw = new Uint8Array(MASK_N * MASK_N)
      let dark = 0
      for (let my = 0; my < MASK_N; my++) {
        for (let mx = 0; mx < MASK_N; mx++) {
          const dx = mx - 20
          const dy = my - 20
          if (dx * dx + dy * dy > 19 * 19) continue
          const sx = cx - 20 + mx
          const sy = cy - 20 + my
          if (sx < 0 || sy < 0 || sx >= warped.width || sy >= warped.height) continue
          const v = gray[sy * warped.width + sx]
          if (Math.abs(v - stat.color) > 30) { raw[my * MASK_N + mx] = 1; dark++ }
        }
      }
      if (dark < 10) {
        // 只有边框/格线，没有可辨认字形
        cells[idx] = { piece: null, confidence: 0.2 }
        continue
      }
      const mask = normalizeMask(raw)
      let best = 0
      let second = 0
      let bestIdx = 0
      const glyphs = isRed ? GLYPHS_RED : GLYPHS_BLACK
      for (let t = 0; t < glyphs.length; t++) {
        let glyphBest = 0
        for (const tpl of templates[glyphs[t]] ?? []) {
          const s = dice(mask, tpl)
          if (s > glyphBest) glyphBest = s
        }
        if (glyphBest > best) { second = best; best = glyphBest; bestIdx = t }
        else if (glyphBest > second) second = glyphBest
      }
      const piece = (isRed ? PIECE_RED[bestIdx] : PIECE_BLACK[bestIdx]) as PieceChar
      // 分类置信度：模板 IoU 与「有子」裕度各占一半
      // 置信度看两点：最佳与次佳的差距（分不清）+ 绝对匹配度（模板本身是否像）
      const margin = best - second
      const conf = Math.min(
        best < 0.6 ? 0.4 : 1,
        Math.max(0, Math.min(1, margin * 3 + 0.15)),
      )
      cells[idx] = { piece, confidence: conf }
      // 置信度过低时仍给出猜测，但由 UI 标黄让人工确认
      grid[c][r] = piece
    }
  }

  return { cells, grid, count: cells.filter(x => x.piece).length }
}

/** 识别结果 → FEN 里可用的棋盘（保留 turn 由调用方决定） */
export function recognizedToFen(grid: PieceChar[][], turn: Turn): string {
  const rows: string[] = []
  for (let r = 0; r < 10; r++) {
    let row = ''
    let empty = 0
    for (let c = 0; c < 9; c++) {
      const p = grid[c][r]
      if (p === '.') { empty++; continue }
      if (empty) { row += String(empty); empty = 0 }
      row += p
    }
    if (empty) row += String(empty)
    rows.push(row)
  }
  return `${rows.join('/')} ${turn} - - 0 1`
}
