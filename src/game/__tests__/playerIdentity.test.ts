/**
 * 玩家身份解析测试
 *
 * 回归背景：错题本/弱点分析/战绩统计只认 header 里字面值 '玩家'，
 * 用户导入的棋谱（天天象棋等，Red/Black 是真实姓名）永远进不了训练闭环。
 */
import { describe, it, expect } from 'vitest'
import { resolvePlayerSide } from '../playerIdentity'

describe('resolvePlayerSide（纯函数）', () => {
  it('App 内建对局：按「玩家」标记判定', () => {
    expect(resolvePlayerSide({ Red: '玩家', Black: '中级' })).toBe('w')
    expect(resolvePlayerSide({ Red: '高级', Black: '玩家' })).toBe('b')
  })

  it('导入棋谱：按「我的棋手名」匹配红黑方', () => {
    const header = { Red: '张三', Black: '李四' }
    expect(resolvePlayerSide(header, '张三')).toBe('w')
    expect(resolvePlayerSide(header, '李四')).toBe('b')
    expect(resolvePlayerSide(header, '王五')).toBeNull()
  })

  it('姓名匹配大小写与首尾空白不敏感', () => {
    expect(resolvePlayerSide({ Red: 'Zhang San', Black: 'Li Si' }, '  zhang san ')).toBe('w')
  })

  it('未设置棋手名时只认内建对局', () => {
    expect(resolvePlayerSide({ Red: '张三', Black: '李四' })).toBeNull()
    expect(resolvePlayerSide({ Red: '张三', Black: '李四' }, '   ')).toBeNull()
  })

  it('大师棋谱/双方同名（自战）不判定为我的对局', () => {
    expect(resolvePlayerSide({ Red: '许银川', Black: '吕钦' }, '王天一')).toBeNull()
    expect(resolvePlayerSide({ Red: '张三', Black: '张三' }, '张三')).toBeNull()
  })

  it('双人局（玩家一/玩家二）不误判', () => {
    expect(resolvePlayerSide({ Red: '玩家一', Black: '玩家二' })).toBeNull()
    expect(resolvePlayerSide({ Red: '玩家一', Black: '玩家二' }, '玩家一')).toBe('w')
  })

  it('缺字段不抛错', () => {
    expect(() => resolvePlayerSide({}, '张三')).not.toThrow()
    expect(resolvePlayerSide({}, '张三')).toBeNull()
  })
})
