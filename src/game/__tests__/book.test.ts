/**
 * 开局库测试
 */
import { describe, it, expect } from 'vitest'
import { getBookMove, loadOpeningBook, isBookLoaded, _setBookDataForTest } from '../book'

describe('内置兜底定式', () => {
  it('未加载大数据书时返回常见首着', () => {
    _setBookDataForTest(null)
    const m = getBookMove([])
    expect(['h2e2', 'c3c4', 'c0e2', 'h0g2']).toContain(m)
  })

  it('中炮后返回黑方主流应对', () => {
    _setBookDataForTest(null)
    const m = getBookMove(['h2e2'])
    expect(['b9c7', 'h9g7', 'h7e7']).toContain(m)
  })

  it('超出定式范围返回 null', () => {
    _setBookDataForTest(null)
    expect(getBookMove(Array(12).fill('h2e2'))).toBeNull()
  })
})

describe('大数据开局书', () => {
  const book = {
    maxPly: 10,
    positions: {
      // 红方视角: a 得分率高但少，b 主流
      '': [{ m: 'a1a2', n: 5, wr: 0.6 }, { m: 'b1b2', n: 900, wr: 0.52 }],
      // 行棋方为黑: wr 为红方视角 0.6 → 黑方视角仅 0.4，应被过滤只剩主线
      'x1x2': [{ m: 'low1', n: 50, wr: 0.6 }, { m: 'main1', n: 300, wr: 0.55 }],
      // 全部低分 → 兜底取第一条
      'y1y2': [{ m: 'bad1', n: 20, wr: 0.3 }, { m: 'bad2', n: 10, wr: 0.2 }],
    },
  }

  it('注入后生效且候选来自库内', () => {
    _setBookDataForTest(book)
    for (let i = 0; i < 20; i++) {
      const m = getBookMove([])
      expect(['a1a2', 'b1b2']).toContain(m)
    }
    expect(isBookLoaded()).toBe(true)
  })

  it('黑行棋局面过滤红视角高分但黑视角低分的着法', () => {
    _setBookDataForTest({
      maxPly: 10,
      positions: {
        // key 为单个着法（长度1）→ 黑方行棋；'low1' 红视角 0.6 = 黑视角 0.4 < 0.45 被过滤
        'd0d1': [{ m: 'low1', n: 100, wr: 0.6 }, { m: 'main1', n: 200, wr: 0.55 }],
      },
    })
    for (let i = 0; i < 30; i++) {
      expect(getBookMove(['d0d1'])).toBe('main1')
    }
  })

  it('全部低于阈值时兜底返回第一条', () => {
    _setBookDataForTest({
      maxPly: 10,
      // key 长度 2 → 红方行棋；两条着法红方得分率都过低 → 过滤后兜底取第一条
      positions: {
        'e0e1 f0f1': [{ m: 'bad1', n: 20, wr: 0.3 }, { m: 'bad2', n: 10, wr: 0.2 }],
      },
    })
    expect(getBookMove(['e0e1', 'f0f1'])).toBe('bad1')
  })

  it('maxPly 截断', () => {
    _setBookDataForTest(book)
    expect(getBookMove(Array(10).fill('a0a1'))).toBeNull()
  })

  it('真实开局书文件可加载且首着为主流着法', async () => {
    // 直接读生成的数据文件验证格式（不依赖 fetch）
    const { readFileSync, existsSync } = await import('fs')
    const path = new URL('../../../public/opening-book.json', import.meta.url).pathname
    if (!existsSync(path)) {
      console.warn('跳过：opening-book.json 未生成')
      return
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    expect(data.positions[''].length).toBeGreaterThan(0)
    for (const c of data.positions['']) {
      expect(c.m).toMatch(/^[a-i][0-9][a-i][0-9]$/)
      expect(c.n).toBeGreaterThanOrEqual(3)
      expect(c.wr).toBeGreaterThan(0)
      expect(c.wr).toBeLessThan(1)
    }
    // 中炮应对应存在
    expect(data.positions['h2e2']).toBeDefined()
  })
})
