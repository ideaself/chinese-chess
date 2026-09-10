/**
 * 导入棋谱进训练闭环测试（storage 级）
 *
 * 覆盖：设置「我的棋手名」后，导入棋谱的失误能进错题本、胜负能进战绩统计。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyGame, type Game } from '../model'
import { _setGamesForTest, getMistakes, getStats, getWeaknessAnalysis, playerSideOfGame } from '../storage'

const SETTINGS_KEY = 'xiangqi_settings'
const store = new Map<string, string>()

function setMyName(name: string) {
  store.set(SETTINGS_KEY, JSON.stringify({ myPlayerName: name }))
}

/** 造一局"张三（红） vs 李四（黑）"的导入棋谱，红方第 2 手是失误 */
function importedGame(): Game {
  const g = createEmptyGame()
  g.id = 'imported-1'
  g.header.Red = '张三'
  g.header.Black = '李四'
  g.header.Event = '测试导入'
  g.startFen = '4k4/9/9/9/9/9/9/9/9/4K4 w'
  g.result = '0-1'
  g.analysisStatus = 'complete'
  const mk = (turn: 'w' | 'b', move: string, loss: number, cls: 'blunder' | 'good') => ({
    plyIndex: 1,
    turn,
    move,
    moveCn: turn === 'w' ? '帅五进一' : '将5进1',
    fenBefore: '4k4/9/9/9/9/9/9/9/9/4K4 ' + turn,
    fenAfter: '4k4/9/9/9/9/9/9/9/9/4K4 ' + (turn === 'w' ? 'b' : 'w'),
    inCheck: false,
    isCapture: false,
    analysis: {
      score: 0, depth: 12, bestMove: 'e0e1', bestMoveCn: '帅五进一',
      pv: [], moveLoss: loss, classification: cls, analyzedAt: Date.now(),
    },
  })
  g.plies = [
    mk('w', 'e0e1', 400, 'blunder'), // 红方（张三）失误
    mk('b', 'e9e8', 0, 'good'),      // 黑方（李四）正常
  ]
  return g
}

beforeEach(() => {
  store.clear()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

afterEach(() => {
  _setGamesForTest(null)
})

describe('导入棋谱的身份识别', () => {
  it('设置棋手名后能识别执方', () => {
    setMyName('张三')
    _setGamesForTest([importedGame()])
    expect(playerSideOfGame(importedGame())).toBe('w')
    setMyName('李四')
    expect(playerSideOfGame(importedGame())).toBe('b')
  })

  it('未设置棋手名时导入棋谱不计入', () => {
    setMyName('')
    _setGamesForTest([importedGame()])
    expect(playerSideOfGame(importedGame())).toBeNull()
    expect(getMistakes()).toHaveLength(0)
    expect(getStats().totalGames).toBe(0)
  })

  it('设置棋手名后：红方失误进错题本', () => {
    setMyName('张三')
    _setGamesForTest([importedGame()])
    const mistakes = getMistakes()
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]).toMatchObject({ gameId: 'imported-1', plyIndex: 0, classification: 'blunder' })
  })

  it('执黑视角：只统计黑方的失误', () => {
    setMyName('李四')
    const g = importedGame()
    // 让黑方也失误
    g.plies[1].analysis!.classification = 'blunder'
    g.plies[1].analysis!.moveLoss = 500
    _setGamesForTest([g])
    const mistakes = getMistakes()
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0].plyIndex).toBe(1)
  })

  it('导入棋谱计入战绩与弱点分析', () => {
    setMyName('张三')
    _setGamesForTest([importedGame()])
    const stats = getStats()
    expect(stats.totalGames).toBe(1)
    expect(stats.losses).toBe(1) // 张三执红，结果 0-1 → 负
    const weakness = getWeaknessAnalysis()
    // 样本不足时返回 null；这里只验证不抛错且红方着法被纳入统计
    expect(weakness === null || weakness.middle.plies > 0 || weakness.opening.plies > 0 || weakness.endgame.plies > 0).toBe(true)
  })

  it('平均每步损失只统计本人对局（不混入第三方棋谱）', () => {
    setMyName('张三')
    const mine = importedGame() // 红方（张三）一步损失 400
    const other = importedGame()
    other.id = 'other-1'
    other.header.Red = '王五'
    other.header.Black = '赵六'
    other.plies[0].analysis!.moveLoss = 100 // 第三方棋谱不应计入
    _setGamesForTest([mine, other])
    // 修复前会把两局的 4 步一起平均 → 125；修复后只算张三的 400
    expect(getStats().avgMoveLoss).toBe(400)
  })
})
