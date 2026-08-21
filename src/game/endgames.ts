/**
 * 残局训练预设 - 计划第22节 V2"残局训练"
 *
 * 均为红方必胜的经典练习局面，玩家执红 vs 引擎防守。
 */

export interface EndgamePreset {
  id: string
  name: string
  fen: string
  desc: string
}

export const ENDGAME_PRESETS: EndgamePreset[] = [
  {
    id: 'rook-king',
    name: '单车杀孤王',
    fen: '3k5/9/9/9/9/9/9/9/9/R3K4 w',
    desc: '车的基本杀法：先困住黑将，再逐步压缩空间完成绝杀。',
  },
  {
    id: 'rook-pawn-king',
    name: '车兵杀孤王',
    fen: '3k5/9/9/9/9/9/9/4P4/9/R3K4 w',
    desc: '车兵配合：兵控制九宫肋线，车伺机成杀。',
  },
  {
    id: 'horse-cannon-king',
    name: '马炮杀孤王',
    fen: '3k5/9/9/9/9/9/9/9/4C4/4K1N2 w',
    desc: '马炮联攻：可演练"马后炮"等经典杀型。',
  },
]
