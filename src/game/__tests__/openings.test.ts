/**
 * 开局训练线路生成测试（语料驱动）
 *
 * 回归背景：开局训练原先只有 4 条硬编码线路，1.4MB 的开局书（141k 局语料）
 * 只给 AI 走子用；现在按语料频率生成主线，并带"多少局走过、红方得分率"。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { _setBookDataForTest } from '../book'
import {
  OPENING_LINES, getOpeningLines, buildOpeningLinesFromBook, _setOpeningLinesForTest,
} from '../openings'

/** 一条 6 手的中炮对屏风马主线（合成语料） */
const BOOK = {
  maxPly: 10,
  positions: {
    '': [{ m: 'h2e2', n: 1000, wr: 0.5 }],
    'h2e2': [{ m: 'h9g7', n: 900, wr: 0.48 }],
    'h2e2 h9g7': [{ m: 'h0g2', n: 800, wr: 0.47 }],
    'h2e2 h9g7 h0g2': [{ m: 'i9h9', n: 700, wr: 0.46 }],
    'h2e2 h9g7 h0g2 i9h9': [{ m: 'i0h0', n: 600, wr: 0.45 }],
    'h2e2 h9g7 h0g2 i9h9 i0h0': [{ m: 'b9c7', n: 500, wr: 0.44 }],
  },
}

afterEach(() => {
  _setBookDataForTest(null)
  _setOpeningLinesForTest(null)
})

describe('开局书生成线路', () => {
  it('未生成时使用内置定式', () => {
    expect(getOpeningLines()).toBe(OPENING_LINES)
  })

  it('按语料主线生成线路，并带上局数与得分率', async () => {
    _setBookDataForTest(BOOK as never)
    const lines = await buildOpeningLinesFromBook()
    expect(lines).toHaveLength(1)
    const line = lines[0]
    expect(line.id).toBe('book:h2e2h9g7h0g2i9h9i0h0b9c7')
    expect(line.moves).toEqual(['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b9c7'])
    expect(line.names).toHaveLength(6)
    expect(line.names[0]).toBe('炮二平五')
    // 名称复用棋谱库分类
    expect(line.name).toContain('中炮')
    // 统计文案：首手有得分率，末手给出局数
    expect(line.notes[0]).toContain('1,000 局')
    expect(line.notes[0]).toContain('50%')
    expect(line.desc).toContain('500')
  })

  it('线路过短（<4 手）不生成', async () => {
    _setBookDataForTest({
      maxPly: 10,
      positions: {
        '': [{ m: 'h2e2', n: 1000, wr: 0.5 }],
        'h2e2': [{ m: 'h9g7', n: 900, wr: 0.48 }],
      },
    } as never)
    expect(await buildOpeningLinesFromBook()).toEqual([])
  })

  it('冷门首着（局数过低）不进训练', async () => {
    _setBookDataForTest({
      maxPly: 10,
      positions: {
        '': [{ m: 'h2e2', n: 5, wr: 0.5 }],
        'h2e2': [{ m: 'h9g7', n: 4, wr: 0.48 }],
        'h2e2 h9g7': [{ m: 'h0g2', n: 3, wr: 0.47 }],
        'h2e2 h9g7 h0g2': [{ m: 'i9h9', n: 2, wr: 0.46 }],
        'h2e2 h9g7 h0g2 i9h9': [{ m: 'i0h0', n: 1, wr: 0.45 }],
      },
    } as never)
    expect(await buildOpeningLinesFromBook()).toEqual([])
  })

  it('开局书不可用时返回空数组且不抛错', async () => {
    _setBookDataForTest(null)
    await expect(buildOpeningLinesFromBook()).resolves.toEqual([])
  })
})
