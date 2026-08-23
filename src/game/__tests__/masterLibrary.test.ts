/**
 * 大师棋谱库分类测试
 */
import { describe, it, expect } from 'vitest'
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
