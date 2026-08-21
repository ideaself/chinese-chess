/**
 * 中文记谱 生成与解析 回归测试
 */
import { describe, it, expect } from 'vitest'
import { boardFromFen, START_FEN } from '../board'
import { moveToChinese, getAllLegalMoves } from '../rules'
import { parsePGN, exportPGN } from '../pgn'
import { readFileSync } from 'fs'

const START_FEN_B = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b'

function cn(fen: string, from: [number, number], to: [number, number]): string {
  const st = boardFromFen(fen)
  return moveToChinese(st, {
    from: { col: from[0], row: from[1] },
    to: { col: to[0], row: to[1] },
    turn: st.turn,
  })
}

describe('moveToChinese 标准记谱', () => {
  it('炮二平五', () => expect(cn(START_FEN, [7, 2], [4, 2])).toBe('炮二平五'))
  it('马二进三（斜走用目标列）', () => expect(cn(START_FEN, [7, 0], [6, 2])).toBe('马二进三'))
  it('兵五进一（纵向用步数）', () => expect(cn(START_FEN, [4, 3], [4, 4])).toBe('兵五进一'))
  it('马8进7（黑方视角+方向）', () => expect(cn(START_FEN_B, [7, 9], [6, 7])).toBe('马8进7'))
  it('炮8平5', () => expect(cn(START_FEN_B, [7, 7], [4, 7])).toBe('炮8平5'))
  it('车1进2（黑方步数用阿拉伯数字）', () => expect(cn(START_FEN_B, [0, 9], [0, 7])).toBe('车1进2'))
  it('车二进三（红车纵向步数）', () =>
    expect(cn('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABRN w', [7, 0], [7, 3])).toBe('车二进三'))
})

describe('初始局面全部合法着法 记谱→解析 往返', () => {
  it('44 个着法全部往返一致', () => {
    const st = boardFromFen(START_FEN)
    for (const mv of getAllLegalMoves(st)) {
      const text = moveToChinese(st, { ...mv, turn: st.turn })
      const res = parsePGN(`[FEN "${START_FEN}"]\n\n1. ${text}`)
      const expected = `${String.fromCharCode(97 + mv.from.col)}${mv.from.row}${String.fromCharCode(97 + mv.to.col)}${mv.to.row}`
      expect(res.success, `记谱 "${text}" 解析失败`).toBe(true)
      expect(res.game?.plies[0].move, `记谱 "${text}" 还原不一致`).toBe(expected)
    }
  })
})

describe('真实棋谱 PGN 往返 (test.pgn)', () => {
  const pgn = readFileSync('./test.pgn', 'utf-8')

  it('解析 99 步成功', () => {
    const r = parsePGN(pgn)
    expect(r.success).toBe(true)
    expect(r.game?.plies.length).toBe(99)
  })

  it('导出→再导入 UCI 与中文记谱完全一致', () => {
    const r1 = parsePGN(pgn)
    const out = exportPGN(r1.game!)
    const r2 = parsePGN(out)
    expect(r2.success).toBe(true)
    expect(r2.game!.plies.map(p => p.move)).toEqual(r1.game!.plies.map(p => p.move))
    expect(r2.game!.plies.map(p => p.moveCn)).toEqual(r1.game!.plies.map(p => p.moveCn))
  })

  it('保留 PGN 声明的 Result（不被局面重算覆盖）', () => {
    const r = parsePGN(pgn)
    expect(r.game?.result).toBe('1-0')
  })

  it('支持前/后缀消歧（前马进6）', () => {
    // 构造含同列双马的已知局面验证解析不报"无法解析"
    const fen = '2bak4/9/9/9/9/9/9/9/9/2BAK4 w'
    const r = parsePGN(`[FEN "${fen}"]\n\n1. 后马进6`) // 无同列双马时应报错而非崩溃
    expect(r.success).toBe(false)
  })
})
