/**
 * 错误重走/残局训练 slice
 */
import type { AppState, StoreSet, StoreGet } from '../types'
import type { Turn, Pos } from '../types'
import { makeMove, boardFromFen, boardToFen, coordToPos } from '../../game/board'
import { chineseFromFen, pvToChinese } from '../../game/rules'
import { createEmptyGame } from '../../game/model'
import { getAllGames } from '../../game/storage'
import { boardFromGame, parseMoveFromUci, startGameClock } from '../helpers'
import { BOARD_HOME } from '../constants'
import type { PuzzleItem } from '../../game/puzzles'
import { recordPuzzleCorrect, recordPuzzleWrong, getDailyPuzzle, getPuzzles, puzzleAnswer, puzzleKey, puzzleDifficulty, puzzleTask, puzzleDropText } from '../../game/puzzles'
import { recordPuzzleAnswer, recordMistakeRetry, isMistakeAutoMastered, amendPuzzleWrongToRight } from '../../game/progress'
import { toggleMastered } from '../../game/storage'
import { engineEvalOnce, acquireEngineSlot, releaseEngineSlot } from '../../game/masterPreanalysis'
import { getChallenge } from '../../game/challenges'

/** 殊途同归判定的搜索深度（与题库生成口径一致） */
const PUZZLE_JUDGE_DEPTH = 12

/** 正在重走的错题去重键（局面|着法），用于错题重练追踪；题库/每日题时为 null */
let activeMistakeKey: string | null = null

/**
 * 进入题库题前的对局快照。
 * 题库题为单步合成棋局，退出时必须还原玩家原来的对局，
 * 否则会停在一盘"假复盘"上（历史 bug）。
 */
let puzzleReturn: {
  game: AppState['game']
  mode: AppState['mode']
  currentPlyIndex: number
} | null = null

/**
 * 引擎追认"殊途同归"：玩家着法与引擎并列第一时改判正确。
 *
 * 题库/错题重走原先只认唯一 UCI，把同等好着判成错（名局拆解早已有同样机制）。
 * 引擎不可用/搜索失败时保持答错，不阻塞答题。
 */
async function judgePuzzleAlternative(
  get: StoreGet,
  set: StoreSet,
  uci: string,
  move: { from: Pos; to: Pos },
  attempt: number,
): Promise<void> {
  const s = get()
  const src = s.puzzleSource
  if (s.puzzlePlyIndex === null) return
  if (!s.engine || !s.engineReady || s.isThinking) return
  const ply = s.game.plies[s.puzzlePlyIndex]
  if (!ply) return
  const fen = ply.fenBefore
  if (src) set({ puzzleSource: { ...src, checking: true } })
  try {
    await acquireEngineSlot(() => get().isThinking)
    let ev = null
    try {
      ev = await engineEvalOnce(s.engine, fen, PUZZLE_JUDGE_DEPTH)
    } finally {
      releaseEngineSlot()
    }
    // 换题/换局面/又走了一步 → 丢弃本次结果
    const cur = get()
    if (cur.puzzlePlyIndex !== s.puzzlePlyIndex || cur.game.startFen !== s.game.startFen) return
    const q = cur.puzzleSource
    const stale = cur.puzzleResult !== 'wrong' || cur.puzzleAttempts !== attempt
    if (stale || !ev || ev.bestMove !== uci) {
      if (q?.checking) set({ puzzleSource: { ...q, checking: false } })
      return
    }
    const st = boardFromGame(cur.game, cur.puzzlePlyIndex)
    const newState = makeMove(st, { from: move.from, to: move.to, turn: st.turn })
    set({
      puzzleResult: 'correct',
      board: newState,
      lastMove: { from: move.from, to: move.to, turn: st.turn },
      ...(q ? { puzzleSource: { ...q, aiAgree: true, checking: false } } : {}),
    })
    // 战绩回滚：刚记的答错改为答对
    amendPuzzleWrongToRight({ type: q?.type, difficulty: q?.difficulty, key: q?.key })
    if (activeMistakeKey) recordMistakeRetry(activeMistakeKey, true)
    cur.showToast('AI 也推荐这手棋，判为正确 ✓')
  } catch {
    const q = get().puzzleSource
    if (q?.checking) set({ puzzleSource: { ...q, checking: false } })
  }
}

export function createPuzzleSlice(set: StoreSet, get: StoreGet): Pick<AppState,
  'puzzlePlyIndex' | 'puzzleAttempts' | 'puzzleResult' | 'puzzleRevealed' | 'puzzleHintLevel' | 'puzzleLine' | 'puzzleLineLoading' | 'puzzleSource' | 'endgameTraining' | 'startPuzzle' | 'startLibraryPuzzle' | 'nextLibraryPuzzle' | 'exitPuzzle' | 'puzzleTryMove' | 'revealPuzzleHint' | 'revealPuzzleAnswer' | 'loadPuzzleLine' | 'startPuzzleFromGame' | 'startEndgameTraining' | 'startWeeklyChallenge' | 'exitEndgameTraining' | 'replayQuizMistake'> {
  return {
  endgameTraining: false,

    puzzlePlyIndex: null,

    puzzleAttempts: 0,

    puzzleResult: 'waiting',

    puzzleRevealed: false,

    puzzleHintLevel: 0,

    puzzleLine: null,

    puzzleLineLoading: false,

    puzzleSource: null,

  // ── 变化推演 ──

    startPuzzle: (plyIndex) => {
    const { game, mode, timerInterval } = get()
    const ply = game.plies[plyIndex]
    if (!ply || !ply.analysis?.bestMove) return
    if (timerInterval) clearInterval(timerInterval)
    activeMistakeKey = null
    puzzleReturn = null // 错题重走：退出时回到该棋谱的复盘（非题库快照）

    set({
      mode: 'puzzle',
      modeBeforeSetup: mode === 'puzzle' ? 'replay' : mode,
      timerInterval: null,
      puzzlePlyIndex: plyIndex,
      puzzleAttempts: 0,
      puzzleResult: 'waiting',
      puzzleRevealed: false,
      puzzleHintLevel: 0,
      puzzleLine: null,
      puzzleLineLoading: false,
      board: boardFromGame(game, plyIndex), // 决策局面（失误那步之前）
      currentPlyIndex: plyIndex,
      selected: null,
      legalTargets: [],
      lastMove: plyIndex > 0
        ? parseMoveFromUci(game.plies[plyIndex - 1].move, game.plies[plyIndex - 1].turn)
        : null,
    })
  },

    /** 精选题库: 构造单步棋谱复用重走判定（杀局/失误题/残局题） */

    startLibraryPuzzle: (p: PuzzleItem) => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)
    activeMistakeKey = null
    // 连续「下一题」时保留最初的来源页（否则退出会落到对战页而不是训练列表）
    const chaining = get().mode === 'puzzle'
    const replayOrigin = chaining ? (get().replayOrigin ?? get().mobilePage) : get().mobilePage
    const replayOriginTab = chaining ? (get().replayOriginTab ?? get().activeTab) : get().activeTab
    // 首次进入题库题时记录原对局；连续「下一题」不覆盖（否则会快照成合成棋局）
    if (get().mode !== 'puzzle' || !puzzleReturn) {
      puzzleReturn = { game: get().game, mode: get().mode, currentPlyIndex: get().currentPlyIndex }
    }
    // 是否当日挑战题（同题型且 game_id+ply 匹配，供完成标记）
    const daily = getDailyPuzzle(p.type)
    const isDaily = !!daily && daily.game_id === p.game_id && daily.ply === p.ply

    const turn = p.fen.split(' ')[1] === 'b' ? 'b' : 'w'
    // 判定答案：杀局题实战着法即制胜一击，答案与实战一致；
    // 失误题/残局题实战着是失误，答案取引擎最佳着
    const answerUci = puzzleAnswer(p)
    const answerCn = answerUci.length >= 4 ? chineseFromFen(p.fen, answerUci) : undefined
    const game = createEmptyGame()
    game.startFen = p.fen
    game.header.Event = p.event || p.type
    game.header.Red = p.red
    game.header.Black = p.black
    game.header.Result = p.result
    game.plies = [{
      plyIndex: 1,
      turn,
      move: p.move_uci,
      moveCn: p.move_uci.length >= 4 ? chineseFromFen(p.fen, p.move_uci) : '',
      fenBefore: p.fen,
      fenAfter: p.fen,
      inCheck: false,
      isCapture: false,
      analysis: {
        score: p.score_before ?? 0,
        depth: 12,
        bestMove: answerUci,
        bestMoveCn: answerCn,
        pv: [answerUci],
        moveLoss: Math.max(0, p.score_drop ?? 0),
        classification: 'blunder',
        analyzedAt: Date.now(),
      },
    }]

    set({
      mode: 'puzzle',
      endgameTraining: false,
      modeBeforeSetup: 'replay',
      timerInterval: null,
      game,
      board: boardFromFen(p.fen),
      puzzlePlyIndex: 0,
      puzzleAttempts: 0,
      puzzleResult: 'waiting',
      puzzleRevealed: false,
      puzzleHintLevel: 0,
      puzzleLine: null,
      puzzleLineLoading: false,
      puzzleSource: {
        type: p.type,
        title: p.event || '',
        red: p.red,
        black: p.black,
        mover: turn,
        drop: p.score_drop ?? 0,
        // 难度/任务类型按局面事实判定（题库 type 标签与掉分不可靠，见 puzzles.ts）
        difficulty: puzzleDifficulty(p),
        task: puzzleTask(p),
        dropText: puzzleDropText(p),
        key: puzzleKey(p),
        isDaily,
      },
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
      activeTab: 'play',
      mobilePage: 'play' as const,
      replayOrigin,
      replayOriginTab,
    })
  },

    /**
     * 下一题：同题型、同难度优先，随机换一题（每日挑战/智能出题/题库通用）。
     * 不离开训练模式，避免"做完一题只能退出"。
     */
    nextLibraryPuzzle: () => {
    const src = get().puzzleSource
    if (!src) return
    const pool = getPuzzles()
    if (!pool || pool.length === 0) {
      get().showToast('题库未加载，请退出后重试')
      return
    }
    const curFen = get().game.startFen
    const sameType = pool.filter(p => p.type === src.type && p.fen !== curFen)
    const sameDiff = sameType.filter(p => puzzleDifficulty(p) === src.difficulty)
    const pick = sameDiff.length > 0 ? sameDiff : sameType.length > 0 ? sameType : pool
    get().startLibraryPuzzle(pick[Math.floor(Math.random() * pick.length)])
  },

    exitPuzzle: () => {
    const { game, currentPlyIndex, replayOrigin, replayOriginTab, modeBeforeSetup } = get()
    activeMistakeKey = null
    // 题库题是单步合成棋局：还原进入前的对局，不要停在"假复盘"上
    const back = puzzleReturn
    puzzleReturn = null
    const restore = back
      ? { game: back.game, mode: back.mode, currentPlyIndex: back.currentPlyIndex, board: boardFromGame(back.game, back.currentPlyIndex) }
      : { mode: modeBeforeSetup === 'puzzle' ? ('replay' as const) : modeBeforeSetup, board: boardFromGame(game, currentPlyIndex) }
    set({
      ...restore,
      endgameTraining: false,
      puzzlePlyIndex: null,
      puzzleResult: 'waiting',
      puzzleRevealed: false,
      puzzleHintLevel: 0,
      puzzleLine: null,
      puzzleLineLoading: false,
      puzzleSource: null,
      selected: null,
      legalTargets: [],
      activeTab: replayOriginTab ?? 'play',
      mobilePage: replayOrigin ?? 'play',
      replayOrigin: null,
      replayOriginTab: null,
    })

    // 回到进行中的对局时恢复棋钟（进入题目时已 clearInterval）
    const st = get()
    if (st.mode === 'play' && st.game.result === '*' && !st.timerInterval
      && !st.openingTraining && !st.endgameTraining) {
      set({ timerInterval: startGameClock(set, get) })
    }
  },

  /** 重走尝试: 命中最佳着法 → 正确；否则提示再想想（不落子） */

    puzzleTryMove: (from, to) => {
    const { game, puzzlePlyIndex, puzzleAttempts } = get()
    if (puzzlePlyIndex === null) return false

    const expected = game.plies[puzzlePlyIndex].analysis?.bestMove
    if (!expected) return false

    const uci = `${String.fromCharCode(97 + from.col)}${from.row}${String.fromCharCode(97 + to.col)}${to.row}`
    set({ selected: null, legalTargets: [] })

    if (uci === expected) {
      // 正确: 在棋盘上演示最佳着法
      const st = boardFromGame(game, puzzlePlyIndex)
      const newState = makeMove(st, { from, to, turn: st.turn })
      set({
        puzzleResult: 'correct',
        board: newState,
        lastMove: { from, to, turn: st.turn },
      })
      const src = get().puzzleSource
      if (src) {
        // 题库题：完整统计（题型/难度/每日完成 + streak）
        recordPuzzleAnswer({
          type: src.type,
          difficulty: src.difficulty,
          correct: true,
          isDaily: src.isDaily,
          key: src.key,
        })
      } else {
        recordPuzzleCorrect()
      }
      if (activeMistakeKey) {
        recordMistakeRetry(activeMistakeKey, true)
        if (isMistakeAutoMastered(activeMistakeKey)) {
          toggleMastered(activeMistakeKey)
          get().showToast('连续答对 2 次，错题已自动标记掌握 ✓')
        }
      }
    } else {
      set({ puzzleResult: 'wrong', puzzleAttempts: puzzleAttempts + 1 })
      const src = get().puzzleSource
      if (src) {
        recordPuzzleAnswer({
          type: src.type,
          difficulty: src.difficulty,
          correct: false,
          isDaily: src.isDaily,
          key: src.key,
        })
      } else {
        recordPuzzleWrong()
      }
      if (activeMistakeKey) recordMistakeRetry(activeMistakeKey, false)
      // 引擎追认：若玩家着法与引擎并列第一，稍后改判正确（殊途同归）
      void judgePuzzleAlternative(get, set, uci, { from, to }, puzzleAttempts + 1)
    }
    return true
  },

    /** 分级提示：0 → 提示子力 → 提示着法性质（不直接给答案） */
    revealPuzzleHint: () => set(s => ({ puzzleHintLevel: Math.min(2, s.puzzleHintLevel + 1) })),

    /**
     * 拉取"答案之后"的引擎变化线，回答"为什么应走这步"。
     * 只搜答案走完后的局面（深度与判定一致），用户点击或答对时按需触发。
     */
    loadPuzzleLine: () => {
    const s = get()
    if (s.puzzlePlyIndex === null || s.puzzleLine !== null || s.puzzleLineLoading) return
    const ply = s.game.plies[s.puzzlePlyIndex]
    const answer = ply?.analysis?.bestMove
    if (!answer || answer.length < 4) return
    const engine = s.engine
    if (!engine || !s.engineReady) { get().showToast('引擎未就绪，稍后再试'); return }
    const st = boardFromGame(s.game, s.puzzlePlyIndex)
    const after = makeMove(st, {
      from: coordToPos(answer.slice(0, 2)),
      to: coordToPos(answer.slice(2, 4)),
      turn: st.turn,
    })
    const fenAfter = boardToFen(after)
    set({ puzzleLineLoading: true })
    void (async () => {
      try {
        await acquireEngineSlot(() => get().isThinking)
        let ev = null
        try {
          ev = await engineEvalOnce(engine, fenAfter, PUZZLE_JUDGE_DEPTH)
        } finally {
          releaseEngineSlot()
        }
        const cur = get()
        // 换题/退出后丢弃结果
        if (cur.puzzlePlyIndex === null || cur.game.startFen !== s.game.startFen) return
        if (!ev) { set({ puzzleLineLoading: false, puzzleLine: [] }); return }
        const pv = ev.pv.length > 0 ? ev.pv : (ev.bestMove ? [ev.bestMove] : [])
        set({ puzzleLine: pvToChinese(fenAfter, pv, 6), puzzleLineLoading: false })
      } catch {
        set({ puzzleLineLoading: false, puzzleLine: [] })
      }
    })()
  },

    revealPuzzleAnswer: () => set({ puzzleRevealed: true }),

  /** 错题本入口: 载入对应棋谱后进入重走模式 */

    startPuzzleFromGame: (gameId, plyIndex) => {
    const g = getAllGames().find(x => x.id === gameId)
    if (!g || !g.plies[plyIndex]?.analysis?.bestMove) return

    const replayOrigin = get().mobilePage
    const replayOriginTab = get().activeTab
    // 先以 replay 形式载入该棋谱（退出重走时回到它的复盘）
    set({
      game: g,
      mode: 'replay',
      endgameTraining: false,
      currentPlyIndex: plyIndex,
      // 移动端多层导航：从错题本进入时切换到对战页
      mobilePage: 'play' as const,
      activeTab: 'play',
      replayOrigin,
      replayOriginTab,
    })
    get().startPuzzle(plyIndex)
    // 错题重练追踪键（与 getMistakes 去重键一致：局面|着法）；
    // startPuzzle 内会先清空，这里在其后设置
    const ply = g.plies[plyIndex]
    activeMistakeKey = `${ply.fenBefore.split(' ').slice(0, 2).join(' ')}|${ply.move}`
  },

  /** 残局训练: 自定义起始局面，玩家执红先行 */

    startEndgameTraining: (fen, name, side = 'w') => {
    const { timerInterval } = get()
    if (timerInterval) clearInterval(timerInterval)
    puzzleReturn = null
    // 「下一关」重入时保留最初来源页
    const chaining = get().endgameTraining
    const replayOrigin = chaining ? (get().replayOrigin ?? get().mobilePage) : get().mobilePage
    const replayOriginTab = chaining ? (get().replayOriginTab ?? get().activeTab) : get().activeTab

    const game = createEmptyGame()
    game.startFen = fen
    game.header.Event = side === 'w' ? '残局训练' : '残局训练（执黑）'
    game.header.Red = side === 'w' ? '玩家' : name
    game.header.Black = side === 'b' ? '玩家' : name

    set({
      mode: 'play',
      endgameTraining: true,
      game,
      board: boardFromFen(fen),
      playerSide: side,
      sideControl: { w: side === 'w' ? 'human' : 'ai', b: side === 'b' ? 'human' : 'ai' },
      currentPlyIndex: 0,
      selected: null,
      legalTargets: [],
      lastMove: null,
      analysis: null,
      redTime: 0,
      blackTime: 0,
      puzzlePlyIndex: null,
      // 移动端多层导航：残局训练切换到对战页
      mobilePage: 'play' as const,
      activeTab: 'play',
      replayOrigin,
      replayOriginTab,
    })

    const interval = startGameClock(set, get)
    set({ timerInterval: interval })
  },

  /** 天天象棋残局挑战：以存档第 n 期局面开局（红先，AI 执黑） */
    startWeeklyChallenge: (n) => {
    const item = getChallenge(n)
    if (!item) {
      get().showToast('该期局面未收录')
      return
    }
    get().startEndgameTraining(item.fen, `残局挑战 第${n}期`)
    const g = get().game
    set({
      game: {
        ...g,
        header: {
          ...g.header,
          Event: '天天象棋残局挑战',
          Round: String(n),
          Date: item.date || g.header.Date,
          Red: '玩家',
          Black: `残局挑战第${n}期`,
        },
      },
    })
  },


  /** 退出残局训练：还原进入前的页面并开新对局（桌面返回键与结算弹窗共用） */

    exitEndgameTraining: () => {
    const origin = get().replayOrigin ?? 'play'
    const originTab = get().replayOriginTab ?? 'play'
    get().restart()
    set({
      endgameTraining: false,
      mobilePage: origin,
      activeTab: originTab,
      sheetTab: BOARD_HOME,
      replayOrigin: null,
      replayOriginTab: null,
    })
  },

  /** 重演拆解错题：退出拆解，从提问局面执原行棋方 vs 引擎 */

    replayQuizMistake: (m) => {
    set({ masterQuiz: null })
    get().startEndgameTraining(m.fen, '错题重演', m.turn)
  },

  /** 在 base 局面上应用前 k 步 PV */
  }
}
