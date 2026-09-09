/**
 * 题库难度/任务类型/文案测试
 *
 * 回归背景（v1.22 修正）：
 *   1. 旧难度按 score_drop 分档，而题库 600 题全部是绝杀级失误（drop 最小 29700），
 *      导致一律判为「高级」——难度筛选与自适应出题的难度阶梯完全失效；
 *   2. 题库里 62 道标为「杀局」的题实为行棋方已成败势的防守题，提示文案与局面相反；
 *   3. 提示里显示「掉分 60000cp」（实为绝杀分差，cp 单位无意义）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  puzzleAnswer, puzzleDifficulty, puzzleTask, puzzleDropText,
  puzzleHintPiece, puzzleHintNature,
  type PuzzleItem,
} from '../puzzles'

/** 红车 e7→e8 贴脸绝杀（见 rules.test.ts 的一步成杀用例） */
const MATE_IN_1_FEN = '4k4/3P1P3/4R4/9/9/9/9/9/9/4K4 w'

function mk(over: Partial<PuzzleItem> = {}): PuzzleItem {
  return {
    type: '失误题',
    game_id: 1,
    ply: 1,
    fen: MATE_IN_1_FEN,
    move_uci: 'e7e8',
    best_move: 'e7e8',
    score_before: 30000,
    score_drop: 30000,
    result: '1-0',
    event: '测试',
    red: '红',
    black: '黑',
    ...over,
  }
}

describe('puzzleAnswer', () => {
  it('杀局取实战着法，其余取引擎最佳着', () => {
    expect(puzzleAnswer(mk({ type: '杀局', move_uci: 'e7e8', best_move: 'e7d7' }))).toBe('e7e8')
    expect(puzzleAnswer(mk({ type: '失误题', move_uci: 'e7d7', best_move: 'e7e8' }))).toBe('e7e8')
  })
})

describe('puzzleDifficulty（按局面事实分档）', () => {
  it('走出答案即绝杀 → 初级', () => {
    expect(puzzleDifficulty(mk({ best_move: 'e7e8' }))).toBe('初级')
  })

  it('已是必胜局面但非一步杀 → 中级', () => {
    expect(puzzleDifficulty(mk({ best_move: 'e7d7', score_before: 30000 }))).toBe('中级')
  })

  it('均势局面找最佳着 → 高级', () => {
    expect(puzzleDifficulty(mk({ best_move: 'e7d7', score_before: 50 }))).toBe('高级')
  })

  it('黑方行棋时按行棋方视角判断（红方视角分取负）', () => {
    // 黑方行棋且红方大优（红方视角 +30000）→ 行棋方黑方已败 → 高级（防守）
    const p = mk({ fen: MATE_IN_1_FEN.replace(' w', ' b'), best_move: 'e8e9', score_before: 30000 })
    expect(puzzleDifficulty(p)).toBe('高级')
  })

  it('数据异常不抛错（非法 FEN / 非法着法）', () => {
    expect(() => puzzleDifficulty(mk({ fen: 'bad fen', best_move: 'zzzz' }))).not.toThrow()
    expect(() => puzzleDifficulty(mk({ fen: MATE_IN_1_FEN, best_move: '' }))).not.toThrow()
  })
})

describe('puzzleTask（按局面事实判定任务类型）', () => {
  it('行棋方必胜 → 杀王', () => {
    expect(puzzleTask(mk({ score_before: 30000 }))).toBe('杀王')
  })

  it('行棋方已败 → 防守（题库中 62 道误标为杀局的题）', () => {
    expect(puzzleTask(mk({ score_before: -30000 }))).toBe('防守')
  })

  it('均势 → 找最佳着', () => {
    expect(puzzleTask(mk({ score_before: 46 }))).toBe('找最佳着')
  })
})

describe('puzzleDropText（不再对绝杀级分差显示 cp）', () => {
  it('错失绝杀', () => {
    expect(puzzleDropText(mk({ score_drop: 30000, score_before: 30000 }))).toBe('错失绝杀')
  })

  it('一步失误被绝杀', () => {
    expect(puzzleDropText(mk({ score_drop: 30000, score_before: 46 }))).toBe('一步失误被绝杀')
  })

  it('非绝杀分差按兵（100cp=1 兵）表述', () => {
    expect(puzzleDropText(mk({ score_drop: 700, score_before: 0 }))).toBe('严重失误，掉分约 7.0 兵')
    expect(puzzleDropText(mk({ score_drop: 300, score_before: 0 }))).toBe('失误，掉分约 3.0 兵')
    expect(puzzleDropText(mk({ score_drop: 100, score_before: 0 }))).toBe('不够精确，掉分约 1.0 兵')
  })

  it('无掉分（实战着法即最佳着）', () => {
    expect(puzzleDropText(mk({ score_drop: 0 }))).toBe('实战着法即最佳着')
  })
})


describe('分级提示（不直接给答案）', () => {
  it('提示 1：给出该动的子力', () => {
    expect(puzzleHintPiece(mk({ best_move: 'e7e8' }))).toBe('车')
    // 黑方走子按黑方记名
    expect(puzzleHintPiece(mk({
      fen: '4k4/4c4/9/9/9/9/9/9/9/4K4 b', best_move: 'e8e7',
    }))).toBe('炮')
  })

  it('提示 2：区分将军 / 吃子 / 吃子并将军 / 静着', () => {
    expect(puzzleHintNature(mk({ best_move: 'e7e8' }))).toBe('这是一步将军')
    expect(puzzleHintNature(mk({ best_move: 'e7d7' }))).toBe('这是一步静着（不吃子也不将军）')
    expect(puzzleHintNature(mk({
      fen: '4k4/9/9/9/9/9/9/9/4r4/3KR4 w', best_move: 'e0e1',
    }))).toBe('这是一步吃子并将军')
  })

  it('非法数据不抛错', () => {
    expect(() => puzzleHintPiece(mk({ fen: 'bad', best_move: 'zzzz' }))).not.toThrow()
    expect(() => puzzleHintNature(mk({ fen: 'bad', best_move: 'zzzz' }))).not.toThrow()
  })
})
// ── 真实题库回归 ──────────────────────────────────────────────────

function loadPool(): PuzzleItem[] | null {
  try {
    const path = new URL('../../../public/puzzles-v2.json', import.meta.url).pathname
    return JSON.parse(readFileSync(path, 'utf8')) as PuzzleItem[]
  } catch {
    console.warn('跳过：puzzles-v2.json 未生成')
    return null
  }
}

describe('puzzles-v2.json 回归', () => {
  const pool = loadPool()

  it('难度分布不再全部集中在「高级」', () => {
    if (!pool) return
    const counts = { 初级: 0, 中级: 0, 高级: 0 }
    for (const p of pool) counts[puzzleDifficulty(p)]++
    expect(counts.初级, `初级 ${counts.初级}`).toBeGreaterThan(0)
    expect(counts.中级, `中级 ${counts.中级}`).toBeGreaterThan(0)
    expect(counts.高级, `高级 ${counts.高级}`).toBeGreaterThan(0)
    // 旧实现下 600 题全为同一档
    expect(Math.max(counts.初级, counts.中级, counts.高级)).toBeLessThan(pool.length)
  })

  it('绝杀级失误不再出现 cp 文案', () => {
    if (!pool) return
    for (const p of pool) {
      expect(puzzleDropText(p), `${p.type} ${p.fen}`).not.toContain('cp')
    }
  })


  // 题库标签与局面事实的关系（数据侧 quirk 的运行时兜底）
  it('标为「杀局」的题：局面必为绝杀级（杀王或防守），不会是均势找最佳着', () => {
    if (!pool) return
    for (const p of pool.filter(x => x.type === '杀局')) {
      expect(['杀王', '防守'], `${p.fen}`).toContain(puzzleTask(p))
    }
  })

  it('掉分为负的题（着法并未丢分）一律识别为防守题', () => {
    if (!pool) return
    const negative = pool.filter(p => (p.score_drop ?? 0) < 0)
    expect(negative.length).toBeGreaterThan(0) // 题库里确实存在（8 道杀局）
    for (const p of negative) {
      expect(puzzleTask(p), `${p.fen}`).toBe('防守')
    }
  })

  it('任务类型三种都存在，且「防守」题被识别出来', () => {
    if (!pool) return
    const counts = { 杀王: 0, 防守: 0, 找最佳着: 0 }
    for (const p of pool) counts[puzzleTask(p)]++
    expect(counts.杀王).toBeGreaterThan(0)
    expect(counts.找最佳着).toBeGreaterThan(0)
    // 题库里有一批「杀局」实为败势防守题（旧文案会写成"红方走出了杀着"）
    expect(counts.防守).toBeGreaterThan(0)
  })
})
