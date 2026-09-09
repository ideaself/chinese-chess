/**
 * 强制取胜搜索测试（纯规则，无引擎）
 */
import { describe, it, expect } from 'vitest'
import { boardFromFen } from '../board'
import { findForcedWin } from '../mateSearch'
import { ENDGAME_PRESETS } from '../endgames'
import { START_FEN } from '../board'

describe('findForcedWin', () => {
  it('一步杀（车贴脸）', () => {
    const win = findForcedWin(boardFromFen('4k4/3P1P3/4R4/9/9/9/9/9/9/4K4 w'), 1)
    expect(win).toEqual({ plies: 1 })
  })

  it('铁门栓/闷宫：一步杀', () => {
    for (const id of ['iron-bolt', 'smothered-palace']) {
      const p = ENDGAME_PRESETS.find(x => x.id === id)!
      expect(findForcedWin(boardFromFen(p.fen), 1), p.name).toEqual({ plies: 1 })
    }
  })

  it('开局局面在浅层内无强制取胜', () => {
    expect(findForcedWin(boardFromFen(START_FEN), 3, 20_000)).toBeNull()
  })

  it('节点预算耗尽时返回 null 而不是卡死', () => {
    const t0 = Date.now()
    expect(findForcedWin(boardFromFen(START_FEN), 7, 200)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('已被将死的一方无法取胜', () => {
    // 黑方被将死，轮到黑走
    expect(findForcedWin(boardFromFen('R3k4/9/9/9/9/9/9/9/9/4K4 b'), 3)).toBeNull()
  })
})
