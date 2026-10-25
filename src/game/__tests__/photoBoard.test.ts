import { describe, it, expect, beforeAll } from 'vitest'
import {
  BOARD_IMG_H, BOARD_IMG_W, GRID_CELL, GRID_PAD,
  applyHomography, recognizedToFen, recognizeBoard, solveHomography, warpBoard,
  type Corners,
} from '../photoBoard'

// node 环境没有 ImageData，这里给个最小实现（只用到 data/width/height）
beforeAll(() => {
  if (typeof (globalThis as any).ImageData === 'undefined') {
    ;(globalThis as any).ImageData = class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(w: number, h: number) {
        this.width = w
        this.height = h
        this.data = new Uint8ClampedArray(w * h * 4)
      }
    }
  }
})

describe('透视变换', () => {
  it('单位映射：四角不动', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]
    const h = solveHomography(pts, pts)
    expect(h).not.toBeNull()
    for (const p of pts) {
      const q = applyHomography(h!, p)
      expect(q.x).toBeCloseTo(p.x, 6)
      expect(q.y).toBeCloseTo(p.y, 6)
    }
  })

  it('缩放映射：2 倍', () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    const dst = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]
    const h = solveHomography(src, dst)!
    expect(applyHomography(h, { x: 5, y: 5 })).toEqual({ x: 10, y: 10 })
  })

  it('退化输入返回 null', () => {
    const p = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
    expect(solveHomography(p, p)).toBeNull()
  })
})

describe('warpBoard', () => {
  it('把源图四角拉正到目标尺寸，端点采样正确', () => {
    const src = new ImageData(100, 100)
    // 画一个红色区域在 (10,10)-(90,90)，四周蓝底
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const i = (y * 100 + x) * 4
        const inside = x >= 10 && x <= 90 && y >= 10 && y <= 90
        src.data[i] = inside ? 220 : 20
        src.data[i + 1] = inside ? 30 : 30
        src.data[i + 2] = inside ? 30 : 220
        src.data[i + 3] = 255
      }
    }
    const corners: Corners = [
      { x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 },
    ]
    const out = warpBoard(src, corners, 40, 40, 0)
    const at = (x: number, y: number) => {
      const i = (y * 40 + x) * 4
      return { r: out.data[i], g: out.data[i + 1], b: out.data[i + 2] }
    }
    // 四角都落在红色区域内
    for (const [x, y] of [[1, 1], [38, 1], [38, 38], [1, 38]]) {
      const c = at(x, y)
      expect(c.r).toBeGreaterThan(180)
      expect(c.b).toBeLessThan(80)
    }
  })
})

describe('识别', () => {
  /** 造一张标准棋盘图：木色底 + 格线 + 指定位置的棋子圆盘 */
  function syntheticBoard(pieces: Array<[number, number]>): ImageData {
    const w = BOARD_IMG_W
    const h = BOARD_IMG_H
    const img = new ImageData(w, h)
    const put = (x: number, y: number, r: number, g: number, b: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const i = (y * w + x) * 4
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
    }
    // 木色底
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, 200, 178, 140)
    // 格线
    for (let r = 0; r < 10; r++) {
      for (let x = GRID_PAD; x <= GRID_PAD + 8 * GRID_CELL; x++) put(x, GRID_PAD + r * GRID_CELL, 110, 85, 45)
    }
    for (let c = 0; c < 9; c++) {
      for (let y = GRID_PAD; y <= GRID_PAD + 9 * GRID_CELL; y++) put(GRID_PAD + c * GRID_CELL, y, 110, 85, 45)
    }
    // 棋子：浅色圆盘 + 深色十字（模拟字形墨迹）
    for (const [c, r] of pieces) {
      const cx = GRID_PAD + c * GRID_CELL
      const cy = GRID_PAD + r * GRID_CELL
      for (let dy = -22; dy <= 22; dy++) {
        for (let dx = -22; dx <= 22; dx++) {
          if (dx * dx + dy * dy > 22 * 22) continue
          put(cx + dx, cy + dy, 246, 242, 230)
        }
      }
      for (let k = -11; k <= 11; k++) {
        put(cx + k, cy, 60, 40, 30)
        put(cx, cy + k, 60, 40, 30)
        put(cx + k, cy + k, 60, 40, 30)
      }
    }
    return img
  }

  it('空盘不误判', () => {
    const result = recognizeBoard(syntheticBoard([]))
    expect(result.count).toBe(0)
    expect(result.grid.flat().every(p => p === '.')).toBe(true)
  })

  it('识别出棋子位置（4 枚）', () => {
    const spots: Array<[number, number]> = [[0, 0], [4, 9], [2, 3], [8, 6]]
    const result = recognizeBoard(syntheticBoard(spots))
    expect(result.count).toBe(4)
    for (const [c, r] of spots) expect(result.grid[c][r]).not.toBe('.')
  })

  it('满盘 32 子全部识别', () => {
    const spots: Array<[number, number]> = []
    for (let c = 0; c < 9; c++) spots.push([c, 0], [c, 9])
    for (let c = 0; c < 9; c += 2) spots.push([c, 3], [c, 6])
    for (const c of [1, 7]) spots.push([c, 2], [c, 7])
    const result = recognizeBoard(syntheticBoard(spots))
    expect(result.count).toBe(spots.length)
  })
})

describe('recognizedToFen', () => {
  it('空盘 + 红先', () => {
    const grid = Array.from({ length: 9 }, () => Array.from({ length: 10 }, () => '.'))
    expect(recognizedToFen(grid as any, 'w')).toBe('9/9/9/9/9/9/9/9/9/9 w - - 0 1')
  })

  it('默认红先、可改黑先', () => {
    const grid = Array.from({ length: 9 }, () => Array.from({ length: 10 }, () => '.'))
    grid[4][9] = 'k'
    grid[4][0] = 'K'
    expect(recognizedToFen(grid as any, 'w').split(' ')[1]).toBe('w')
    expect(recognizedToFen(grid as any, 'b').split(' ')[1]).toBe('b')
  })
})
