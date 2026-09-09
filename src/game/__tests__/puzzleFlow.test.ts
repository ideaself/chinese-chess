/**
 * 题库答题流程测试（store 级）
 *
 * 回归背景：
 *   1. 做完一题只能「退出」，没有下一题（PuzzlePanel 曾只渲染退出按钮）；
 *   2. exitPuzzle 停在题库题的单步合成棋局上，玩家回到对战页看到的是一盘"假复盘"。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import { createEmptyGame } from '../model'
import { _setPuzzlesForTest, puzzleDifficulty, type PuzzleItem } from '../puzzles'
import { _setOpeningLinesForTest } from '../openings'
import { getTrainingProgress, _resetProgressCacheForTest } from '../progress'
import { ENDGAME_PRESETS } from '../endgames'
import type { PikafishEngine } from '../../engine/pikafish'

/** 红车 e7→e8 贴脸绝杀（一步杀 → 初级） */
const MATE_FEN = '4k4/3P1P3/4R4/9/9/9/9/9/9/4K4 w'

function mk(over: Partial<PuzzleItem>): PuzzleItem {
  return {
    type: '失误题', game_id: 1, ply: 1, fen: MATE_FEN, move_uci: 'e7e8', best_move: 'e7e8',
    score_before: 30000, score_drop: 30000, result: '1-0', event: '测试', red: '红', black: '黑',
    ...over,
  }
}

/** 三道同题型题：两道高级（均势）、一道初级（一步杀） */
const P_HIGH_1 = mk({ fen: '4k4/9/9/9/9/9/9/9/9/4K4 w', move_uci: 'e0e1', best_move: 'e0e1', score_before: 0, score_drop: 0 })
const P_HIGH_2 = mk({ fen: '4k4/9/9/9/9/9/9/9/9/3K5 w', move_uci: 'd0d1', best_move: 'd0d1', score_before: 0, score_drop: 0 })
const P_EASY = mk({ fen: MATE_FEN, move_uci: 'e7e8', best_move: 'e7e8' })

/** 还原一份"玩家自己的对局"到 store */
function seedPlayerGame() {
  const g = createEmptyGame()
  g.id = 'player-game-1'
  g.header.Red = '玩家'
  g.header.Black = '中级'
  g.startFen = '4k4/9/9/9/9/9/9/9/9/4K4 w'
  useStore.setState({
    game: g,
    mode: 'play',
    currentPlyIndex: 0,
    mobilePage: 'home',
    activeTab: 'play',
    puzzleSource: null,
    puzzlePlyIndex: null,
    puzzleResult: 'waiting',
    puzzleRevealed: false,
  })
}

beforeEach(() => {
  _setPuzzlesForTest([P_HIGH_1, P_HIGH_2, P_EASY])
})

afterEach(() => {
  _setPuzzlesForTest(null)
})

describe('startLibraryPuzzle / nextLibraryPuzzle / exitPuzzle', () => {
  it('进入题库题：切到 puzzle 模式并带上难度/任务/文案', () => {
    seedPlayerGame()
    useStore.getState().startLibraryPuzzle(P_EASY)
    const s = useStore.getState()
    expect(s.mode).toBe('puzzle')
    expect(s.puzzleSource?.difficulty).toBe('初级')
    expect(s.puzzleSource?.task).toBe('杀王')
    expect(s.game.startFen).toBe(MATE_FEN)
  })

  it('下一题：同题型同难度优先，且不离开训练模式', () => {
    seedPlayerGame()
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    expect(useStore.getState().puzzleSource?.difficulty).toBe('高级')
    useStore.getState().nextLibraryPuzzle()
    const s = useStore.getState()
    expect(s.mode).toBe('puzzle')
    // 高级候选只有 P_HIGH_2（排除当前局面），应精确命中
    expect(s.game.startFen).toBe(P_HIGH_2.fen)
    expect(s.puzzleSource?.difficulty).toBe('高级')
  })

  it('下一题：同难度没有候选时退回同题型', () => {
    seedPlayerGame()
    useStore.getState().startLibraryPuzzle(P_EASY)
    useStore.getState().nextLibraryPuzzle()
    const s = useStore.getState()
    expect(s.mode).toBe('puzzle')
    expect(s.game.startFen).not.toBe(P_EASY.fen)
    expect(s.puzzleSource?.type).toBe('失误题')
  })

  it('连续下一题不会把合成棋局当成"原对局"', () => {
    seedPlayerGame()
    const original = useStore.getState().game
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    useStore.getState().nextLibraryPuzzle()
    useStore.getState().nextLibraryPuzzle()
    useStore.getState().exitPuzzle()
    expect(useStore.getState().game).toBe(original)
  })

  it('退出题库题：还原进入前的对局与模式（不停在假复盘）', () => {
    seedPlayerGame()
    const original = useStore.getState().game
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    expect(useStore.getState().game).not.toBe(original)
    useStore.getState().exitPuzzle()
    const s = useStore.getState()
    expect(s.game).toBe(original)
    expect(s.mode).toBe('play')
    expect(s.puzzleSource).toBeNull()
    expect(s.puzzlePlyIndex).toBeNull()
    expect(s.mobilePage).toBe('home')
  })

  it('题库未加载时下一题不报错', () => {
    _setPuzzlesForTest(null)
    seedPlayerGame()
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    expect(() => useStore.getState().nextLibraryPuzzle()).not.toThrow()
    expect(useStore.getState().mode).toBe('puzzle')
  })
})

describe('分级提示与殊途同归', () => {
  it('提示逐级展开，最多两级，换题后重置', () => {
    seedPlayerGame()
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    expect(useStore.getState().puzzleHintLevel).toBe(0)
    useStore.getState().revealPuzzleHint()
    expect(useStore.getState().puzzleHintLevel).toBe(1)
    useStore.getState().revealPuzzleHint()
    useStore.getState().revealPuzzleHint() // 第三级封顶
    expect(useStore.getState().puzzleHintLevel).toBe(2)
    useStore.getState().nextLibraryPuzzle()
    expect(useStore.getState().puzzleHintLevel).toBe(0)
  })

  it('答错时无引擎也不报错，保持答错', () => {
    seedPlayerGame()
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    const ok = useStore.getState().puzzleTryMove({ col: 3, row: 0 }, { col: 3, row: 1 })
    expect(ok).toBe(true)
    expect(useStore.getState().puzzleResult).toBe('wrong')
    expect(useStore.getState().puzzleAttempts).toBe(1)
  })

  it('答对：演示着法并判为正确', () => {
    seedPlayerGame()
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    // P_HIGH_1 答案 e0e1（帅进一）
    const ok = useStore.getState().puzzleTryMove({ col: 4, row: 0 }, { col: 4, row: 1 })
    expect(ok).toBe(true)
    expect(useStore.getState().puzzleResult).toBe('correct')
    expect(useStore.getState().lastMove).toMatchObject({ from: { col: 4, row: 0 }, to: { col: 4, row: 1 } })
  })
})
/** 假引擎：直接回调给定 PV（用于测试后续变化线，不依赖真实 WASM） */
function fakeEngine(pv: string[]): PikafishEngine {
  return {
    analyze: async (
      _fen: string, _moves: string[], _depth: number,
      onInfo?: (info: { depth: number; score: number; move: string; pv: string[] }) => void,
    ) => {
      onInfo?.({ depth: 12, score: 20, move: pv[0] ?? '', pv })
      return pv[0] ?? ''
    },
  } as unknown as PikafishEngine
}

describe('后续变化线（为什么）', () => {
  afterEach(() => {
    useStore.setState({ engine: null, engineReady: false, puzzleLine: null, puzzleLineLoading: false })
  })

  it('引擎可用时给出中文后续变化', async () => {
    seedPlayerGame()
    useStore.setState({ engine: fakeEngine(['e9e8', 'e1e2']), engineReady: true, isThinking: false })
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    useStore.getState().loadPuzzleLine()
    await vi.waitFor(() => expect(useStore.getState().puzzleLineLoading).toBe(false))
    const line = useStore.getState().puzzleLine
    expect(line).not.toBeNull()
    expect(line!.length).toBe(2)
    expect(line!.every(m => m.length > 0)).toBe(true)
  })

  it('引擎不可用时提示且不写结果', () => {
    seedPlayerGame()
    useStore.setState({ engine: null, engineReady: false })
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    expect(() => useStore.getState().loadPuzzleLine()).not.toThrow()
    expect(useStore.getState().puzzleLine).toBeNull()
    expect(useStore.getState().puzzleLineLoading).toBe(false)
  })

  it('换下一题会清空上一次的变化线', async () => {
    seedPlayerGame()
    useStore.setState({ engine: fakeEngine(['e9e8']), engineReady: true, isThinking: false })
    useStore.getState().startLibraryPuzzle(P_HIGH_1)
    useStore.getState().loadPuzzleLine()
    await vi.waitFor(() => expect(useStore.getState().puzzleLine).not.toBeNull())
    useStore.getState().nextLibraryPuzzle()
    expect(useStore.getState().puzzleLine).toBeNull()
    expect(useStore.getState().puzzleLineLoading).toBe(false)
  })
})
describe('开局训练流程', () => {
  const LINE = {
    id: 'test-line',
    name: '测试定式',
    desc: '',
    moves: ['h2e2', 'h9g7', 'h0g2', 'i9h9'],
    names: ['炮二平五', '马8进7', '马二进三', '车9平8'],
    notes: ['', '', '', ''],
  }

  afterEach(() => { _setOpeningLinesForTest(null) })

  it('开始记尝试，走完整条记掌握', () => {
    vi.useFakeTimers()
    _resetProgressCacheForTest()
    _setOpeningLinesForTest([LINE])
    useStore.getState().startOpeningTraining('test-line')
    expect(getTrainingProgress().openings['test-line']).toMatchObject({ attempts: 1, completed: false })

    // 玩家第 1 手：炮二平五（h2→e2），随后对手自动应手
    useStore.getState().openingTryMove({ col: 7, row: 2 }, { col: 4, row: 2 })
    vi.advanceTimersByTime(700)
    expect(useStore.getState().openingTraining?.index).toBe(2)

    // 玩家第 2 手：马二进三（h0→g2），对手应手后完成
    useStore.getState().openingTryMove({ col: 7, row: 0 }, { col: 6, row: 2 })
    vi.advanceTimersByTime(700)
    expect(useStore.getState().openingTraining?.status).toBe('done')
    expect(getTrainingProgress().openings['test-line'].completed).toBe(true)
    vi.useRealTimers()
  })

  it('走偏只提示不落子', () => {
    vi.useFakeTimers()
    _resetProgressCacheForTest()
    _setOpeningLinesForTest([LINE])
    useStore.getState().startOpeningTraining('test-line')
    useStore.getState().openingTryMove({ col: 7, row: 2 }, { col: 7, row: 3 }) // 非定式着法
    expect(useStore.getState().openingTraining?.status).toBe('wrong')
    expect(useStore.getState().openingTraining?.index).toBe(0)
    vi.useRealTimers()
  })
})
describe('残局训练流程', () => {
  const P1 = ENDGAME_PRESETS[0]
  const P2 = ENDGAME_PRESETS[1]

  it('下一关重入时保留最初来源页（退出能回到训练列表）', () => {
    useStore.setState({ mobilePage: 'games', activeTab: 'games', endgameTraining: false, replayOrigin: null, replayOriginTab: null })
    useStore.getState().startEndgameTraining(P1.fen, P1.name)
    let s = useStore.getState()
    expect(s.endgameTraining).toBe(true)
    expect(s.replayOrigin).toBe('games')

    useStore.getState().startEndgameTraining(P2.fen, P2.name) // 「下一关」
    s = useStore.getState()
    expect(s.endgameTraining).toBe(true)
    expect(s.game.startFen).toBe(P2.fen)
    expect(s.replayOrigin).toBe('games') // 不能被第二次调用覆盖成 play
  })

  it('退出残局训练：回到来源页并结束训练态', () => {
    useStore.setState({ mobilePage: 'games', activeTab: 'games', endgameTraining: false, replayOrigin: null, replayOriginTab: null })
    useStore.getState().startEndgameTraining(P1.fen, P1.name)
    useStore.getState().exitEndgameTraining()
    const s = useStore.getState()
    expect(s.endgameTraining).toBe(false)
    expect(s.mobilePage).toBe('games')
    expect(s.mode).toBe('play')
  })
})
describe('难度口径', () => {
  it('测试题面按局面事实分档', () => {
    expect(puzzleDifficulty(P_EASY)).toBe('初级')
    expect(puzzleDifficulty(P_HIGH_1)).toBe('高级')
  })
})
