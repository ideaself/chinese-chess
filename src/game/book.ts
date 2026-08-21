/**
 * 内置开局库
 *
 * 覆盖常见首着与主流应对，AI 行棋时优先从库中随机选择，
 * 提升开局质量与多样性；脱离库范围后交由引擎搜索。
 *
 * 键 = 已走着法的 UCI 序列（空格分隔），值 = 候选 UCI 着法。
 * 使用前需经走法合法性校验（aiMove 中兜底）。
 */

const BOOK: Record<string, string[]> = {
  // ── 红方首着 ──
  '': [
    'h2e2', // 炮二平五（中炮）
    'c0e2', // 相三进五（飞相局）
    'c3c4', // 兵七进一（仙人指路）
    'h0g2', // 马二进三（起马局）
    'b2d2', // 炮八平六（过宫炮）
  ],

  // ── 黑方应对 ──
  'h2e2': [
    'b9c7', // 马2进3（屏风马）
    'h7e7', // 炮8平5（顺炮）
    'c6c5', // 卒3进1
  ],
  'c0e2': [
    'h9g7', // 马8进7
    'c6c5', // 卒3进1
  ],
  'c3c4': [
    'b7e7', // 炮2平5
    'c6c5', // 卒3进1（对兵局）
  ],
  'h0g2': [
    'b7c7', // 马2进3
    'h9g7', // 马8进7
  ],
  'b2d2': [
    'h9g7',
    'c6c5',
  ],

  // ── 红方第三着（对屏风马）──
  'h2e2 b9c7': [
    'h0g2', // 马二进三
    'b0c2', // 马八进七
  ],
  // ── 红方第三着（对顺炮）──
  'h2e2 h7e7': [
    'h0g2',
    'b0c2',
  ],
}

/**
 * 查询开局库
 * @param moves 已走着法（UCI 数组）
 * @returns 随机候选着法，或 null（不在库中）
 */
export function getBookMove(moves: string[]): string | null {
  const candidates = BOOK[moves.join(' ')]
  if (!candidates || candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}
