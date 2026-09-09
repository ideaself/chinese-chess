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
    // 修正：原 FEN 少了一段（棋子整体上移一行），现已补全底线
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
  {
    id: 'twin-rook-wind',
    name: '双车错杀',
    fen: '4k4/9/9/9/9/9/9/9/1R7/2RK5 w',
    desc: '双车轮番"错"着逼将：一车控肋、一车将军，交替推进直到绝杀。',
  },
  {
    id: 'horse-behind-cannon',
    name: '马后炮',
    fen: '4k4/9/9/9/9/9/4N4/9/2C6/3K5 w',
    desc: '最经典的杀型：马作炮架，炮在马后直击九宫，将死无解。',
  },
  {
    id: 'smothered-palace',
    name: '闷宫杀',
    // 一步杀：炮二进九（h0h9）借黑士为架将军，黑将退路被自家士堵死
    fen: '4ka3/4a4/9/9/9/9/9/9/9/3K3C1 w',
    desc: '炮沉底借黑方自家士做炮架将军，把将闷死在九宫内——自家子力越多反而越堵。',
  },
  {
    id: 'iron-bolt',
    name: '铁门栓',
    // 一步杀：炮八进九（b0b9）沉底借黑士为架将军，车控肋道封死退路（黑卒保证局面合法）
    fen: '3ak4/4a4/9/9/p8/9/9/9/9/1C2KR3 w',
    desc: '炮沉底借黑方自家士做炮架将军，车控肋道封锁退路——黑方自家子力越多反而越堵。',
  },
  {
    id: 'bold-heart',
    name: '单车破双士',
    // 注意：红方只有一车，无法"弃车取势"——旧文案与局面不符（已修正）
    fen: '3aka3/9/9/9/9/9/9/9/9/2RK5 w',
    desc: '单车对双士的例胜残局：车控肋道、逼士离位，逐步破士成杀。',
  },
  {
    id: 'moon-bottom',
    name: '海底捞月',
    fen: '4k4/9/9/9/4r4/9/9/9/9/CR1K6 w',
    desc: '车炮对车的残局技巧：炮沉底借力驱车，抢占要道成杀。',
  },
  {
    id: 'twin-horse-spring',
    name: '双马饮泉',
    fen: '3k5/9/9/9/9/9/9/9/9/N1N2K3 w',
    desc: '双马轮流卧槽奔袭，如双马饮泉般步步紧逼，演练马的双杀配合。',
  },
  {
    id: 'cannon-rook-fork',
    name: '车炮抽杀',
    fen: '4k4/9/9/9/9/9/9/9/9/C1R2K4 w',
    desc: '车炮联合抽将：一将一抽，先手尽占后从容成杀。',
  },
]
