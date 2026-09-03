/**
 * 大师棋谱库分类测试
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { classifyRecord, classifyLibrary } from '../masterLibrary'

function rec(mv: string, eg = 0) {
  return { id: 1, r: '红方', b: '黑方', res: '红胜', mv, eg }
}

describe('红方布局识别', () => {
  it('中炮', () => expect(classifyRecord(rec('h2e2b9c7')).family).toBe('zhongpao'))
  it('中炮（炮八平五）', () => expect(classifyRecord(rec('b2e2h9g7')).family).toBe('zhongpao'))
  it('飞相局', () => expect(classifyRecord(rec('c0e2b9c7')).family).toBe('feixiang'))
  it('仙人指路', () => expect(classifyRecord(rec('c3c4h9g7')).family).toBe('xianren'))
  it('起马局', () => expect(classifyRecord(rec('h0g2h9g7')).family).toBe('qima'))
  it('过宫炮', () => expect(classifyRecord(rec('h2d2h9g7')).family).toBe('guogong'))
  it('士角炮', () => expect(classifyRecord(rec('h2f2h9g7')).family).toBe('shijiao'))
  it('其他', () => expect(classifyRecord(rec('e3e4h9g7')).family).toBe('other'))
})

describe('黑方应法识别（中炮局）', () => {
  it('屏风马', () => {
    const cls = classifyRecord(rec('h2e2b9c7h0g2h9g7i0h0i9h9'))
    expect(cls.family).toBe('zhongpao')
    expect(cls.defense).toBe('pingfengma')
  })

  it('顺炮（黑炮8平5，同向）', () => {
    const cls = classifyRecord(rec('h2e2h7e7h0g2b9c7'))
    expect(cls.defense).toBe('shunpao')
  })

  it('列炮（黑炮2平5，反向）', () => {
    const cls = classifyRecord(rec('h2e2b7e7h0g2h9g7'))
    expect(cls.defense).toBe('liepao')
  })

  it('反宫马（双正马+士角炮）', () => {
    const cls = classifyRecord(rec('h2e2b9c7h0g2h9g7i0h0b7d7'))
    expect(cls.defense).toBe('fangongma')
  })

  it('非中炮局不识别应法', () => {
    const cls = classifyRecord(rec('c3c4b7e7'))
    expect(cls.family).toBe('xianren')
    expect(cls.defense).toBeUndefined()
  })
})

describe('残局标签', () => {
  it('eg ≥15 标记为残局丰富', () => {
    expect(classifyRecord(rec('h2e2h7e7'.repeat(4), 20)).endgame).toBe(true)
  })
  it('eg <15 不标记', () => {
    expect(classifyRecord(rec('h2e2h7e7'.repeat(4), 5)).endgame).toBe(false)
  })
})

describe('classifyLibrary 批量', () => {
  it('保留原字段并附加分类', () => {
    const out = classifyLibrary([rec('h2e2b9c7')])
    expect(out[0].cls.family).toBe('zhongpao')
    expect(out[0].r).toBe('红方')
  })
})

describe('fetchGameById 定点取局（v1.21 解除 5 万局上限）', () => {
  it('按 ranges 二分定位分片并命中 id；未收录返回 null', async () => {
    vi.resetModules()
    const mk = (id: number, mv: string) => ({ id, mv, eg: 0, r: '红方', b: '黑方', res: '红胜' })
    const files: Record<string, unknown> = {
      'master-games/manifest.json': {
        generatedAt: '', source: '', total: 2, maxId: 3000, shardSize: 2,
        shards: ['shard_0.json', 'shard_1.json'], ranges: [[1, 1000], [1001, 3000]],
      },
      'master-games/shard_0.json': [mk(1, 'h2e2'), mk(500, 'c3c4')],
      'master-games/shard_1.json': [mk(2500, 'b2e2')],
    }
    ;(globalThis as any).fetch = async (url: string) => ({
      ok: url in files,
      status: url in files ? 200 : 404,
      json: async () => files[url],
    })
    const lib = await import('../masterLibrary')
    const hit = await lib.fetchGameById(2500)
    expect(hit?.mv).toBe('b2e2')
    expect((await lib.fetchGameById(1))?.mv).toBe('h2e2')
    expect(await lib.fetchGameById(99999)).toBeNull()
    expect(lib.getOpenableMaxId()).toBe(3000)
  })

  it('canOpenGame 以 manifest maxId 为准（经 similar.ensureOpenableLimit）', async () => {
    vi.resetModules()
    const files: Record<string, unknown> = {
      'master-games/manifest.json': {
        generatedAt: '', source: '', total: 1, maxId: 142433, shardSize: 1,
        shards: ['shard_0.json'], ranges: [[1, 142433]],
      },
    }
    ;(globalThis as any).fetch = async (url: string) => ({
      ok: url in files,
      status: url in files ? 200 : 404,
      json: async () => files[url],
    })
    const similar = await import('../similar')
    expect(similar.canOpenGame(50000)).toBe(true) // 未就绪时旧上限兜底
    expect(similar.canOpenGame(50001)).toBe(false)
    const limit = await similar.ensureOpenableLimit()
    expect(limit).toBe(142433)
    expect(similar.canOpenGame(142433)).toBe(true)
    expect(similar.canOpenGame(200000)).toBe(false)
  })
})

describe('真实分片数据回归（防 dpxq/UCI 格式错配）', () => {
  it('生成的分片为 UCI 且开局分类非全部 other', () => {
    const shard = join(process.cwd(), 'public', 'master-games', 'shard_0.json')
    if (!existsSync(shard)) {
      console.warn('跳过：分片未生成')
      return
    }
    const games = JSON.parse(readFileSync(shard, 'utf-8'))
    expect(games.length).toBeGreaterThan(100)
    // mv 必须是 UCI 连写
    for (const g of games.slice(0, 50)) {
      expect(g.mv).toMatch(/^[a-i][0-9]([a-i][0-9])+$/)
    }
    const cls = classifyLibrary(games)
    const others = cls.filter(g => g.cls.family === 'other').length
    // 真实大师对局绝大多数可识别布局；若格式错配会 100% other
    expect(others / cls.length).toBeLessThan(0.3)
  }, 30000)
})
