/**
 * 大师局预分析测试：关键点选取、缓存损失计算、高价值关键手挑选、
 * 缓存物化（applyCachedAnalysis）与预热缺口计算
 */
import { describe, it, expect } from 'vitest'
import {
  fenAtPosition, keyPositionIndices, moveLossFromEvals, pickBestKeyPly,
  classifyMove, applyCachedAnalysis, missingKeyPositions,
} from '../masterPreanalysis'
import { MASTER_ANALYSIS_FMT, type MasterAnalysisRecord } from '../storage'
import { buildGameFromRecord } from '../dhtmlxq'

/** 一局真实合法的中炮开局（前几手无吃子无将军） */
const MV = 'h2e2b9c7h0g2h9g7i0h0i9h9h0h6c6c5'

function makeGame(mv = MV) {
  const r = buildGameFromRecord({ id: 1, mv })
  expect(r.success).toBe(true)
  return r.game!
}

function makeRec(evals: Record<number, { score: number; depth?: number }>, fmt = MASTER_ANALYSIS_FMT): MasterAnalysisRecord {
  const out: MasterAnalysisRecord['evals'] = {}
  for (const [k, v] of Object.entries(evals)) {
    out[Number(k)] = { score: v.score, depth: v.depth ?? 12, bestMove: 'a0a1', pv: [] }
  }
  return { gameId: 'dpxq_1', fmt, depth: 12, createdAt: 0, evals: out }
}

/** 只保留指定 ply 的关键手标记，便于构造确定性场景 */
function flagKeys(game: ReturnType<typeof makeGame>, keys: number[]) {
  game.plies.forEach((p, i) => {
    p.isCapture = keys.includes(i)
    p.inCheck = false
  })
}

describe('keyPositionIndices', () => {
  it('每个关键手取 {k, k+1} 且升序去重', () => {
    const game = makeGame()
    const keys = game.plies
      .map((p, i) => (p.isCapture || p.inCheck ? i : -1))
      .filter(i => i >= 0)
    const idx = keyPositionIndices(game)
    const expected = new Set<number>()
    for (const k of keys) { expected.add(k); expected.add(k + 1) }
    expect(idx).toEqual([...expected].sort((a, b) => a - b))
  })

  it('无关键手时返回空数组', () => {
    const game = makeGame('h2e2b9c7')
    expect(keyPositionIndices(game)).toEqual([])
  })
})

describe('moveLossFromEvals', () => {
  it('before + after 取正（走棋方视角衔接）', () => {
    expect(moveLossFromEvals(makeRec({ 3: { score: 100 }, 4: { score: -60 } }), 3)).toBe(40)
  })

  it('负损失截为 0（改善着法）', () => {
    expect(moveLossFromEvals(makeRec({ 3: { score: 50 }, 4: { score: -90 } }), 3)).toBe(0)
  })

  it('缺任一手返回 null', () => {
    expect(moveLossFromEvals(makeRec({ 3: { score: 50 } }), 3)).toBeNull()
    expect(moveLossFromEvals(makeRec({ 4: { score: 50 } }), 3)).toBeNull()
  })

  it('深度不足不采信', () => {
    expect(moveLossFromEvals(makeRec({ 3: { score: 500, depth: 8 }, 4: { score: 0 } }), 3)).toBeNull()
  })

  it('损失截断与整盘分析一致（±1500）', () => {
    // 极端 mate 分先截断：+20000→1500，对方视角 +1500（我方被将死）不放大
    expect(moveLossFromEvals(makeRec({ 3: { score: 20000 }, 4: { score: 1500 } }), 3))
      .toBe(1500 + 1500)
    expect(moveLossFromEvals(makeRec({ 3: { score: -20000 }, 4: { score: 1500 } }), 3)).toBe(0)
  })
})

describe('pickBestKeyPly', () => {
  it('无候选关键手返回 -1', () => {
    const game = makeGame()
    flagKeys(game, [])
    expect(pickBestKeyPly(game, 0, null)).toBe(-1)
  })

  it('无有效缓存时退化为首个关键手', () => {
    const game = makeGame()
    flagKeys(game, [2, 6])
    expect(pickBestKeyPly(game, 0, null)).toBe(2)
    expect(pickBestKeyPly(game, 3, null)).toBe(6)
    expect(pickBestKeyPly(game, 0, makeRec({}, 999))).toBe(2) // fmt 不符
  })

  it('有缓存时优先分歧最大（moveLoss 最高）的关键手', () => {
    const game = makeGame()
    flagKeys(game, [2, 6])
    const rec = makeRec({
      2: { score: 30 }, 3: { score: -10 },  // 小损：优势 30→10，loss 20
      6: { score: 100 }, 7: { score: 200 }, // 大师送优：+100 变对方 +200，loss 300
    })
    expect(pickBestKeyPly(game, 0, rec)).toBe(6)
  })

  it('缺 after 手的候选不参与比较，不影响其余选择', () => {
    const game = makeGame()
    flagKeys(game, [2, 6])
    const rec = makeRec({ 2: { score: 50 }, 3: { score: -10 } }) // 只有 2 有完整前后手
    expect(pickBestKeyPly(game, 0, rec)).toBe(2)
  })

  it('fromPly 之后的候选才参与', () => {
    const game = makeGame()
    flagKeys(game, [2, 6])
    expect(pickBestKeyPly(game, 4, null)).toBe(6)
  })

  it('同损失保持更早的关键手', () => {
    const game = makeGame()
    flagKeys(game, [2, 6])
    const rec = makeRec({
      2: { score: 100 }, 3: { score: -50 },
      6: { score: 100 }, 7: { score: -50 },
    })
    expect(pickBestKeyPly(game, 0, rec)).toBe(2)
  })
})

describe('fenAtPosition', () => {
  it('局面序号对应第 i 手之前的 FEN', () => {
    const game = makeGame()
    expect(fenAtPosition(game, 0)).toBe(game.startFen)
    expect(fenAtPosition(game, 1)).toBe(game.plies[0].fenAfter)
    expect(fenAtPosition(game, 3)).toBe(game.plies[2].fenAfter)
  })
})

describe('classifyMove（与整盘分析一致）', () => {
  it('阈值分档', () => {
    expect(classifyMove(0)).toBe('best')
    expect(classifyMove(9)).toBe('excellent')
    expect(classifyMove(29)).toBe('good')
    expect(classifyMove(79)).toBe('inaccuracy')
    expect(classifyMove(149)).toBe('mistake')
    expect(classifyMove(299)).toBe('blunder')
    expect(classifyMove(300)).toBe('blunder2')
  })
})

describe('missingKeyPositions', () => {
  it('只补缺失/深度不足的局面', () => {
    const game = makeGame()
    flagKeys(game, [2, 6])
    const rec = makeRec({ 2: { score: 10, depth: 12 }, 3: { score: 0, depth: 8 } })
    const miss = missingKeyPositions(game, rec)
    expect(miss).toContain(3) // 深度不足
    expect(miss).not.toContain(2) // 已缓存够深
    expect(miss).toEqual(keyPositionIndices(game).filter(i => i !== 2))
  })

  it('无缓存时返回全部关键局面', () => {
    const game = makeGame()
    expect(missingKeyPositions(game, null)).toEqual(keyPositionIndices(game))
  })
})

describe('applyCachedAnalysis', () => {
  it('有完整前后手缓存的 ply 被物化，损失与分类正确', () => {
    const game = makeGame()
    flagKeys(game, [2])
    const rec = makeRec({}) as MasterAnalysisRecord
    // loss = max(0, before + after) = max(0, 100-100)... 构造明显失误:
    rec.evals[2] = { score: 100, depth: 12, bestMove: game.plies[2].move, pv: [] }
    rec.evals[3] = { score: 100, depth: 12, bestMove: 'a0a1', pv: [] }
    // before=100, after=-100（对方视角 -1 兵）→ loss = 0？注意 after 为对方视角:
    // 对方 -100 表示我方优 100，无损失。改用 after=+100（对方反优）→ loss=200
    rec.evals[3].score = 100

    const out = applyCachedAnalysis(game.plies, rec)
    expect(out).not.toBe(game.plies)
    expect(out[2].analysis).toBeTruthy()
    expect(out[2].analysis!.bestMove).toBe(game.plies[2].move)
    expect(out[2].analysis!.moveLoss).toBe(200)
    expect(out[2].analysis!.classification).toBe('blunder')
    // 非关键手未物化
    expect(out[5].analysis ?? null).toBeFalsy()
  })

  it('缺后手的 ply 不物化', () => {
    const game = makeGame()
    flagKeys(game, [2, 6])
    const rec = makeRec({ 2: { score: 50 } }) // 缺 k+1
    const out = applyCachedAnalysis(game.plies, rec)
    expect(out[2].analysis ?? null).toBeFalsy()
    expect(out).toBe(game.plies)
  })

  it('fmt 不符返回原数组引用', () => {
    const game = makeGame()
    const rec = { ...makeRec({}), fmt: 999 }
    expect(applyCachedAnalysis(game.plies, rec as never)).toBe(game.plies)
  })

  it('无可新增数据时返回原数组引用', () => {
    const game = makeGame()
    const rec = makeRec({}) // 空缓存
    expect(applyCachedAnalysis(game.plies, rec)).toBe(game.plies)
  })
})
