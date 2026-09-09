/**
 * 玩家身份解析（"这局棋是不是我的，我执哪一方"）
 *
 * 背景：错题本 / 弱点分析 / 战绩统计 / 对局总结原先只认 header 里字面值 `'玩家'`，
 * 那是 App 内建对局才写的标记。用户从天天象棋/弈天等平台导入自己的棋谱后，
 * Red/Black 是真实姓名，于是这些棋谱永远进不了训练闭环。
 *
 * 现在：内建对局仍按 `'玩家'` 判定；导入棋谱按设置里的「我的棋手名」匹配红黑方姓名。
 * 本模块保持纯函数（不读 localStorage），避免与 storage.ts 形成循环依赖。
 */

export type PlayerSide = 'w' | 'b'

/** 归一化姓名：去空白、大小写不敏感 */
function normName(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * 解析"我"在该局执哪一方。
 * @param header 棋谱 header（读 Red / Black）
 * @param myName 设置里的「我的棋手名」，为空则只认内建对局的 '玩家' 标记
 * @returns 'w' 我执红 / 'b' 我执黑 / null 不是我的对局（或双方同名无法判断）
 */
export function resolvePlayerSide(
  header: Record<string, string | undefined>,
  myName = '',
): PlayerSide | null {
  const red = header.Red ?? ''
  const black = header.Black ?? ''

  // 1) App 内建对局：恰好一方是 '玩家'
  const redIsMe = red.trim() === '玩家'
  const blackIsMe = black.trim() === '玩家'
  if (redIsMe !== blackIsMe) return redIsMe ? 'w' : 'b'

  // 2) 导入棋谱：按姓名匹配
  const name = normName(myName)
  if (!name) return null
  const redMatch = normName(red) === name
  const blackMatch = normName(black) === name
  if (redMatch === blackMatch) return null // 都不匹配或双方同名（自战）
  return redMatch ? 'w' : 'b'
}
