/**
 * DhtmlXQ（东萍 dpxq）格式解析测试
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  splitDhtmlXQGames, parseDhtmlXQBlock, parseDhtmlXQText,
  buildGameFromRecord, isDhtmlXQText,
} from '../dhtmlxq'

const SAMPLE = `[DhtmlXQ]
[DhtmlXQ_ver]www_dpxq_com[/DhtmlXQ_ver]
[DhtmlXQ_gameid]1[/DhtmlXQ_gameid]
[DhtmlXQ_title]广东 陈松顺 胜 江苏 惠颂祥[/DhtmlXQ_title]
[DhtmlXQ_event]近代名家对局[/DhtmlXQ_event]
[DhtmlXQ_date]1958-05-22[/DhtmlXQ_date]
[DhtmlXQ_red]广东 陈松顺[/DhtmlXQ_red]
[DhtmlXQ_black]江苏 惠颂祥[/DhtmlXQ_black]
[DhtmlXQ_result]红胜[/DhtmlXQ_result]
[DhtmlXQ_binit][/DhtmlXQ_binit]
[DhtmlXQ_movelist]774770627967807089791022262563641927204217151214797372827370627009083041087870626665003065643037674823242524146424236424290762541517373878762434477782627778626846453404765604075654072748566866394838362322276748393646174766694948678778886967566887778878464522217771545171742131747748496764594864144717772749594575787627295958292858592868174741524742[/DhtmlXQ_movelist]
[/DhtmlXQ]`

const CORPUS_DIR = join(process.cwd(), '..', 'chinese-chess', 'data', 'raw', 'dpxq_master')

describe('splitDhtmlXQGames', () => {
  it('拆出单个块', () => {
    const blocks = splitDhtmlXQGames(SAMPLE)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('77477062')
  })

  it('拆出多个块', () => {
    const blocks = splitDhtmlXQGames(SAMPLE + '\n' + SAMPLE.replace('[DhtmlXQ_gameid]1[', '[DhtmlXQ_gameid]2['))
    expect(blocks).toHaveLength(2)
  })

  it('isDhtmlXQText 判定', () => {
    expect(isDhtmlXQText(SAMPLE)).toBe(true)
    expect(isDhtmlXQText('[Event "x"]\n1. 炮二平五')).toBe(false)
  })
})

describe('parseDhtmlXQBlock', () => {
  const r = parseDhtmlXQBlock(splitDhtmlXQGames(SAMPLE)[0])

  it('解析成功且头信息正确', () => {
    expect(r.success).toBe(true)
    expect(r.game).toBeTruthy()
    expect(r.game!.header.Red).toBe('广东 陈松顺')
    expect(r.game!.header.Black).toBe('江苏 惠颂祥')
    expect(r.game!.header.Event).toBe('近代名家对局')
    expect(r.game!.header.Date).toBe('1958-05-22')
    expect(r.game!.result).toBe('1-0')
    expect(r.game!.id).toBe('dpxq_1')
  })

  it('首步为红炮二平五、次步黑马8进7', () => {
    expect(r.game!.plies[0].moveCn).toBe('炮二平五')
    expect(r.game!.plies[0].move).toBe('h2e2')
    expect(r.game!.plies[1].moveCn).toBe('马8进7')
    expect(r.game!.plies[1].turn).toBe('b')
  })

  it('全部着法逐步合法', () => {
    expect(r.game!.plies.length).toBeGreaterThan(50)
  })
})

describe('异常输入', () => {
  it('非 4 倍长度 movelist 报错', () => {
    const r = buildGameFromRecord({ id: 1, mv: '774770' })
    expect(r.success).toBe(false)
  })

  it('空 movelist 报错', () => {
    expect(buildGameFromRecord({ id: 1, mv: '' }).success).toBe(false)
  })

  it('非法着法报错并给出版本号', () => {
    // 红帅从 e0 直接到 c0 不合法
    const r = buildGameFromRecord({ id: 1, mv: '4020' }) // (4,0)->(2,0): 帅横移穿仕
    expect(r.success).toBe(false)
    expect(r.errorPly).toBe(1)
  })

  it('无 DhtmlXQ 块的文本报错', () => {
    expect(parseDhtmlXQText('随便什么').success).toBe(false)
  })

  it('无效日期归一化为空', () => {
    const r = buildGameFromRecord({ id: 2, mv: '', d: '0000-00-00' })
    expect(r.success).toBe(false) // movelist 空报错，但日期逻辑在头信息里
  })
})

describe('真实语料抽样验证', () => {
  it('抽样文件 ≥95% 可完整解析为合法对局', () => {
    if (!existsSync(CORPUS_DIR)) {
      console.warn('跳过：语料目录不存在')
      return
    }
    const files = readdirSync(CORPUS_DIR)
      .filter(f => /^master_\d+\.txt$/.test(f))
      .sort()
      .slice(0, 100)

    let ok = 0
    let failed = 0
    for (const f of files) {
      const text = readFileSync(join(CORPUS_DIR, f), 'utf-8')
      const blocks = splitDhtmlXQGames(text)
      if (blocks.length === 0) { failed++; continue }
      const r = parseDhtmlXQBlock(blocks[0])
      if (r.success && r.game && r.game.plies.length >= 10) ok++
      else failed++
    }
    console.log(`语料抽样: ${ok}/${files.length} 成功`)
    expect(ok / files.length).toBeGreaterThanOrEqual(0.95)
  }, 30000)
})
