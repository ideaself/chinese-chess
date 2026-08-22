/**
 * PGN 多局分割 / 开局库 / 错题本 回归测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { splitPGNGames, parsePGN } from '../pgn'
import { boardFromFen, makeMove, START_FEN } from '../board'
import { getAllLegalMoves, getGameStatus } from '../rules'
import { getBookMove } from '../book'
import { OPENING_LINES } from '../openings'
import type { Game } from '../model'
import { saveGame, getMistakes, toggleMastered, getMasteredKeys } from '../storage'

// ── localStorage stub ──
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

describe('splitPGNGames 多局分割', () => {
  const single = readFileSync('./test.pgn', 'utf-8')

  it('单局识别为 1 且解析 99 步', () => {
    const parts = splitPGNGames(single)
    expect(parts.length).toBe(1)
    const r = parsePGN(parts[0])
    expect(r.success).toBe(true)
    expect(r.game?.plies.length).toBe(99)
  })

  it('两局连排（第二局直接跟标签行）正确切分', () => {
    const two = single.trimEnd() + '\n[Event "第二局"]\n[Red "甲"]\n[Black "乙"]\n\n1. 炮二平五 马2进3\n2. 马二进三 车9进1\n'
    const parts = splitPGNGames(two)
    expect(parts.length).toBe(2)
    expect(parsePGN(parts[0]).game?.plies.length).toBe(99)
    expect(parsePGN(parts[1]).success).toBe(true)
  })

  it('CRLF 兼容', () => {
    expect(splitPGNGames(single.replace(/\n/g, '\r\n')).length).toBe(1)
  })
})

describe('开局库', () => {
  const LINES: Array<[string[], string]> = [
    [[], 'h2e2'], [[], 'c0e2'], [[], 'c3c4'], [[], 'h0g2'], [[], 'b2d2'],
    [['h2e2'], 'b9c7'], [['h2e2'], 'h7e7'], [['h2e2'], 'c6c5'],
    [['c0e2'], 'h9g7'], [['c0e2'], 'c6c5'],
    [['c3c4'], 'b7e7'], [['c3c4'], 'c6c5'],
    [['h0g2'], 'b7c7'], [['h0g2'], 'h9g7'],
    [['b2d2'], 'h9g7'], [['b2d2'], 'c6c5'],
    [['h2e2', 'b9c7'], 'h0g2'], [['h2e2', 'b9c7'], 'b0c2'],
    [['h2e2', 'h7e7'], 'h0g2'], [['h2e2', 'h7e7'], 'b0c2'],
  ]

  it('全部库内着法在对应局面合法', () => {
    for (const [prefix, uci] of LINES) {
      let st = boardFromFen(START_FEN)
      for (const m of prefix) {
        st = makeMove(st, {
          from: { col: m.charCodeAt(0) - 97, row: parseInt(m[1]) },
          to: { col: m.charCodeAt(2) - 97, row: parseInt(m[3]) },
          turn: st.turn,
        })
      }
      const f = { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) }
      const t = { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) }
      const legal = getAllLegalMoves(st)
      expect(
        legal.some(x => x.from.col === f.col && x.from.row === f.row && x.to.col === t.col && x.to.row === t.row),
        `${prefix.join(' ') || '(首着)'} → ${uci} 应合法`,
      ).toBe(true)
    }
  })

  it('首着候选有多样性且库外返回 null', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(getBookMove([])!)
    expect(seen.size).toBeGreaterThanOrEqual(3)
    expect(getBookMove(['a0a1'])).toBeNull()
  })
})

describe('开局训练线路', () => {
  it('全部线路逐步合法且名称数量对应', () => {
    for (const line of OPENING_LINES) {
      expect(line.moves.length).toBe(line.names.length)
      expect(line.moves.length).toBe(line.notes.length)

      let st = boardFromFen(START_FEN)
      for (let i = 0; i < line.moves.length; i++) {
        const uci = line.moves[i]
        const f = { col: uci.charCodeAt(0) - 97, row: parseInt(uci[1]) }
        const t = { col: uci.charCodeAt(2) - 97, row: parseInt(uci[3]) }
        const legal = getAllLegalMoves(st)
        expect(
          legal.some(x => x.from.col === f.col && x.from.row === f.row && x.to.col === t.col && x.to.row === t.row),
          `${line.name} 第 ${i + 1} 步 ${line.names[i]} (${uci}) 应合法`,
        ).toBe(true)
        st = makeMove(st, { from: f, to: t, turn: st.turn })
      }
    }
  })
})

describe('错题本 去重与掌握度', () => {
  const mkGame = (id: string, moveUci: string, fenBefore: string): Game => ({
    id,
    header: { Red: '玩家', Black: '中级', Result: '1-0' },
    startFen: START_FEN,
    result: '1-0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    starred: false,
    analysisStatus: 'complete',
    plies: [{
      plyIndex: 5,
      turn: 'w' as const,
      move: moveUci,
      moveCn: '车九进一',
      fenBefore,
      fenAfter: fenBefore,
      inCheck: false,
      isCapture: false,
      analysis: {
        score: 50, depth: 10, bestMove: 'a0a1', bestMoveCn: '车九进一', pv: [],
        moveLoss: 250, classification: 'blunder' as const, analyzedAt: Date.now(),
      },
    }],
  })

  beforeEach(() => {
    // 两盘棋同一局面同一失误 → 应去重为 1 条
    const fullFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
    saveGame(mkGame('g1', 'a0a1', fullFen))
    saveGame(mkGame('g2', 'a0a1', fullFen.replace('0 1', '4 8'))) // 计数器不同
  })

  it('同局面同着法去重', () => {
    expect(getMistakes().length).toBe(1)
  })

  it('掌握度标记可切换并持久化', () => {
    const key = getMistakes()[0].key
    toggleMastered(key)
    expect(getMasteredKeys().has(key)).toBe(true)
    toggleMastered(key)
    expect(getMasteredKeys().has(key)).toBe(false)
  })
})
