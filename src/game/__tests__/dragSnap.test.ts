import { describe, it, expect } from 'vitest'
import { nearestTarget } from '../../components/Board/Board'
import type { BoardGrid } from '../boardSkinGrids'

const grid: BoardGrid = { x0: 40, xstep: 60, y0: 40, ystep: 60 }
const target = { col: 4, row: 2 }
// 未翻转时该交点的 SVG 坐标
const at = (col: number, row: number) => ({ x: 40 + col * 60, y: 40 + (9 - row) * 60 })
const p = at(target.col, target.row)

describe('拖动落点吸附', () => {
  it('落在目标中心 → 命中', () => {
    expect(nearestTarget(p.x, p.y, [target], false, grid)).toEqual(target)
  })

  it('偏移半格（30px）仍在吸附范围内', () => {
    expect(nearestTarget(p.x + 30, p.y, [target], false, grid)).toEqual(target)
    expect(nearestTarget(p.x, p.y - 30, [target], false, grid)).toEqual(target)
  })

  it('偏移 45px（超过 0.62 格）→ 不命中', () => {
    expect(nearestTarget(p.x + 45, p.y, [target], false, grid)).toBeNull()
  })

  it('多个合法点时取最近的那个', () => {
    const a = { col: 4, row: 2 }
    const b = { col: 5, row: 2 }
    const nearB = { x: at(5, 2).x - 12, y: at(5, 2).y }
    expect(nearestTarget(nearB.x, nearB.y, [a, b], false, grid)).toEqual(b)
  })

  it('翻转棋盘时按翻转后的坐标匹配', () => {
    const flippedTarget = { col: 2, row: 3 }
    // 翻转后：x 用 8-col，y 直接用 row（未翻转是 9-row）
    const fp = { x: at(8 - flippedTarget.col, 0).x, y: 40 + flippedTarget.row * 60 }
    expect(nearestTarget(fp.x, fp.y, [flippedTarget], true, grid)).toEqual(flippedTarget)
  })

  it('没有合法点 → null', () => {
    expect(nearestTarget(p.x, p.y, [], false, grid)).toBeNull()
  })
})
