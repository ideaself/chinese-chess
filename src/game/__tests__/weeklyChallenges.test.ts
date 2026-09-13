/**
 * 天天象棋残局挑战题库回归测试
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { boardFromFen } from '../board'
import { hasLegalMove, getAllLegalMoves } from '../rules'
import type { WeeklyChallenge } from '../challenges'

const file = fileURLToPath(new URL('../../../public/weekly-challenges.json', import.meta.url))

describe('天天象棋残局挑战题库', () => {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { count: number; items: WeeklyChallenge[] }

  it('条目结构完整且期号唯一', () => {
    expect(data.items.length).toBe(data.count)
    expect(data.items.length).toBeGreaterThan(300)
    const seen = new Set<number>()
    for (const item of data.items) {
      expect(item.n).toBeGreaterThan(0)
      expect(item.fen.split(' ')[0].split('/')).toHaveLength(10)
      expect(item.fen.endsWith(' w')).toBe(true)
      expect(seen.has(item.n)).toBe(false)
      seen.add(item.n)
    }
  })

  it('全部局面合法且红方至少有一手可走', () => {
    const bad: Array<{ n: number; why: string }> = []
    for (const item of data.items) {
      const state = boardFromFen(item.fen)
      const flat = item.fen.split(' ')[0]
      const kings = (flat.match(/K/g) ?? []).length + (flat.match(/k/g) ?? []).length
      if (kings !== 2) { bad.push({ n: item.n, why: '王数不为2' }); continue }
      if (state.turn !== 'w') { bad.push({ n: item.n, why: '非红先' }); continue }
      if (!hasLegalMove(state)) { bad.push({ n: item.n, why: '红方无合法着' }); continue }
      if (getAllLegalMoves(state).length > 200) { bad.push({ n: item.n, why: '着法数异常' }) }
    }
    expect(bad).toEqual([])
  })
})
