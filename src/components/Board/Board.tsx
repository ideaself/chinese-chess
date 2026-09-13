/**
 * 棋盘组件 - 点击走棋
 *
 * 纯点击交互:
 *   1. 点击己方棋子 → 选中，高亮合法走法
 *   2. 点击合法目标格 → 走棋
 *   3. 点击其他位置 → 取消选择
 */

import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import type { Pos } from '../../game/board'
import { isRed, boardToFen } from '../../game/board'
import { isInCheck, findKing, chineseFromFen } from '../../game/rules'
import { useMediaQuery, MOBILE_QUERY } from '../../utils/useMediaQuery'
import { EvalBar } from './EvalBar'
import { boardSkinGrids, DEFAULT_BOARD_GRID, type BoardGrid } from '../../game/boardSkinGrids'
import { moveTag } from '../../game/moveTags'

const CELL = 60
const BOARD_COLS = 9
const BOARD_ROWS = 10
const BOARD_PADDING = 40
const BOARD_WIDTH = BOARD_PADDING * 2 + (BOARD_COLS - 1) * CELL
const BOARD_HEIGHT = BOARD_PADDING * 2 + (BOARD_ROWS - 1) * CELL
const PIECE_RADIUS = 26

interface AnimState {
  piece: string
  fromX: number
  fromY: number
  /** 位移增量（CSS 变量 --dx/--dy 驱动 keyframes） */
  dx: number
  dy: number
}

function posToSvg(pos: Pos, flipped: boolean, grid: BoardGrid): { x: number; y: number } {
  const col = flipped ? (BOARD_COLS - 1 - pos.col) : pos.col
  // row 0 = 红方底线 = SVG 底部 (y 最大)
  const row = flipped ? pos.row : (BOARD_ROWS - 1 - pos.row)
  return { x: grid.x0 + col * grid.xstep, y: grid.y0 + row * grid.ystep }
}

function svgToPos(x: number, y: number, flipped: boolean, grid: BoardGrid): Pos {
  let col = Math.round((x - grid.x0) / grid.xstep)
  let svgRow = Math.round((y - grid.y0) / grid.ystep)
  // svgRow 0 = 顶部 = row 9, svgRow 9 = 底部 = row 0
  let row = flipped ? svgRow : (BOARD_ROWS - 1 - svgRow)
  if (flipped) col = BOARD_COLS - 1 - col
  return { col, row }
}

const GLYPHS: Record<string, string> = {
  K: '帅', k: '将', A: '仕', a: '士', B: '相', b: '象',
  N: '马', n: '马', R: '车', r: '车', C: '炮', c: '炮', P: '兵', p: '卒',
}

interface ArrowGeom {
  /** 锥形箭身 path（天天象棋风格：圆头起笔、向箭头收窄） */
  path: string
  n: number
  cx: number
  cy: number
}

/** 天天象棋风格箭头几何：起点圆头、箭身向箭头收窄、三角箭头落在终点中心 */
function arrowGeometry(from: { x: number; y: number }, to: { x: number; y: number }, n: number): ArrowGeom {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const w = Math.min(20, Math.max(12, len * 0.24)) // 尾端全宽
  const baseHalf = w * 0.5
  const neckHalf = w * 0.28
  const headHalf = w * 0.86
  const headLen = Math.min(len * 0.45, Math.max(w * 1.9, len * 0.26))
  const bx = from.x
  const by = from.y
  const hx = to.x - ux * headLen // 箭头基部中心
  const hy = to.y - uy * headLen
  const mx = (bx + hx) / 2
  const my = (by + hy) / 2
  // 尾部半圆帽（并入同一 path，避免叠加导致颜色深浅不一）
  const capK = baseHalf * 0.5523
  const blx = bx + nx * baseHalf
  const bly = by + ny * baseHalf
  const brx = bx - nx * baseHalf
  const bry = by - ny * baseHalf
  const path = [
    `M ${blx} ${bly}`,
    `Q ${mx + nx * baseHalf * 1.08} ${my + ny * baseHalf * 1.08} ${hx + nx * neckHalf} ${hy + ny * neckHalf}`,
    `L ${hx + nx * headHalf} ${hy + ny * headHalf}`,
    `L ${to.x} ${to.y}`,
    `L ${hx - nx * headHalf} ${hy - ny * headHalf}`,
    `L ${hx - nx * neckHalf} ${hy - ny * neckHalf}`,
    `Q ${mx - nx * baseHalf * 1.08} ${my - ny * baseHalf * 1.08} ${brx} ${bry}`,
    `C ${brx - ux * capK} ${bry - uy * capK} ${blx - ux * capK} ${bly - uy * capK} ${blx} ${bly}`,
    'Z',
  ].join(' ')
  return { path, n, cx: from.x, cy: from.y }
}

/** 棋子字符 → 皮肤文件名 (w=红, b=黑) */
function pieceSkinFile(piece: string): string {
  const side = isRed(piece) ? 'w' : 'b'
  return `${side}${piece.toLowerCase()}`
}

export const Board: React.FC = () => {
  const board = useStore(s => s.board)
  const selected = useStore(s => s.selected)
  const legalTargets = useStore(s => s.legalTargets)
  const lastMove = useStore(s => s.lastMove)
  const hintInfo = useStore(s => s.hintInfo)
  const aiPreview = useStore(s => s.aiPreview)
  const boardFlipped = useStore(s => s.boardFlipped)
  const selectPiece = useStore(s => s.selectPiece)
  const isThinking = useStore(s => s.isThinking)
  const mode = useStore(s => s.mode)
  const variation = useStore(s => s.variation)
  const sideControl = useStore(s => s.sideControl)
  const game = useStore(s => s.game)
  const currentPlyIndex = useStore(s => s.currentPlyIndex)
  const redTime = useStore(s => s.redTime)
  const blackTime = useStore(s => s.blackTime)
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // 非对局模式（复盘/推演）：桌面端在棋盘上方显示合并玩家栏；
  // 移动端复盘的双方信息已在页头后退一栏，不再重复显示
  const isPlay = mode === 'play'

  // 棋手标注：复盘/分析/推演显示实际棋手名；实时对战显示 玩家/AI
  const redName = game?.header?.Red
  const blackName = game?.header?.Black
  const redRole = mode === 'play'
    ? (sideControl.w === 'human' ? '玩家' : 'AI')
    : (redName || (sideControl.w === 'human' ? '玩家' : 'AI'))
  const blackRole = mode === 'play'
    ? (sideControl.b === 'human' ? '玩家' : 'AI')
    : (blackName || (sideControl.b === 'human' ? '玩家' : 'AI'))

  // 翻转棋盘时上下玩家信息条跟随（顶=背面方，底=己方）
  const topSide: 'w' | 'b' = boardFlipped ? 'w' : 'b'
  const bottomSide: 'w' | 'b' = boardFlipped ? 'b' : 'w'
  const sideLabel = (side: 'w' | 'b') => side === 'w' ? `红方（${redRole}）` : `黑方（${blackRole}）`
  const sideTime = (side: 'w' | 'b') => side === 'w' ? redTime : blackTime

  const svgRef = useRef<SVGSVGElement>(null)
  const prevBoardRef = useRef<string>('')
  const [anim, setAnim] = useState<AnimState | null>(null)
  // 响应式设置：改皮肤立即生效
  const settings = useStore(s => s.settings)
  const inCheck = isInCheck(board)
  const kingPos = inCheck ? findKing(board, board.turn === 'w') : null

  const useSkin = settings.pieceStyle !== 'classic'
  const boardSkin = settings.boardStyle !== 'classic' ? `/skins/boards/${settings.boardStyle}.webp` : null
  const pieceSkin = useSkin ? `/skins/pieces/${settings.pieceStyle}` : null

  // 棋盘网格几何：经典用固定 BOARD_PADDING/CELL；皮肤按图像实际网格比例对齐，
  // 避免硬编码坐标与皮肤自带网格错位（越偏越大）。
  const grid: BoardGrid = useMemo(() => {
    if (!boardSkin) return { x0: BOARD_PADDING, xstep: CELL, y0: BOARD_PADDING, ystep: CELL }
    const g = boardSkinGrids[settings.boardStyle] ?? DEFAULT_BOARD_GRID
    return { x0: g.x0 * BOARD_WIDTH, xstep: g.xstep * BOARD_WIDTH, y0: g.y0 * BOARD_HEIGHT, ystep: g.ystep * BOARD_HEIGHT }
  }, [boardSkin, settings.boardStyle])

  // 走子动画：挂载即从起点播放 keyframes 到终点，结束后由 onAnimationEnd 清除
  // （设置里关闭「落子动画」后跳过，仅记录棋盘快照）
  useEffect(() => {
    const curr = board.board.map(c => c.join('')).join('')
    if (!lastMove || mode !== 'play' || settings.animationEnabled === false) { prevBoardRef.current = curr; return }
    const prev = prevBoardRef.current
    if (prev && prev !== curr) {
      const from = posToSvg(lastMove.from, boardFlipped, grid)
      const to = posToSvg(lastMove.to, boardFlipped, grid)
      const piece = board.board[lastMove.to.col][lastMove.to.row]
      setAnim({
        piece,
        fromX: from.x,
        fromY: from.y,
        dx: to.x - from.x,
        dy: to.y - from.y,
      })
      // 兜底清除（页面隐藏等情况下 onAnimationEnd 可能不触发）
      const t = setTimeout(() => setAnim(null), 400)
      prevBoardRef.current = curr
      return () => clearTimeout(t)
    }
    prevBoardRef.current = curr
  }, [board, lastMove, boardFlipped, mode, grid, settings.animationEnabled])

  const getSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }, [])

  // 统一指针处理（鼠标/触摸/笔均只触发一次）
  // 注意: 不能混用 onTouchStart+onClick —— 移动端触摸后浏览器会补发合成 click,
  // 造成"选中→立即取消"的一闪现象。
  const handlePointer = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return // 仅主键/触摸
    const { mode, isThinking, boardFlipped, selectPiece, setupClick, variation } = useStore.getState()
    if (isThinking) return
    const coords = getSvgCoords(e.clientX, e.clientY)
    if (!coords) return
    const pos = svgToPos(coords.x, coords.y, boardFlipped, grid)
    if (pos.col < 0 || pos.col >= BOARD_COLS || pos.row < 0 || pos.row >= BOARD_ROWS) return
    if (mode === 'setup') { setupClick(pos); return }
    // 推演/自我分析：允许点选双方棋子试走（selectPiece 内部路由到 variationTryMove）
    if (mode === 'replay' && variation) { selectPiece(pos); return }
    // 错误重走/题库/每日一题：点选走子做答（selectPiece/tryMove 内部路由到 puzzleTryMove）
    if (mode === 'puzzle') { selectPiece(pos); return }
    if (mode !== 'play') return
    selectPiece(pos)
  }, [getSvgCoords, grid])

  // 复盘：棋盘左右滑动翻步（右滑=上一步，左滑=下一步）；其余模式仅记录不处理
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const s = useStore.getState()
    if (s.mode === 'replay' && !s.variation) swipeRef.current = { x: e.clientX, y: e.clientY }
    handlePointer(e)
  }, [handlePointer])
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy) * 1.5) return
    const s = useStore.getState()
    if (s.mode !== 'replay' || s.variation) return
    if (dx > 0) s.goBack()
    else s.goForward()
  }, [])

  // ── 棋盘网格 ──
  const gridLines = React.useMemo(() => {
    const lines: React.ReactNode[] = []
    for (let r = 0; r < BOARD_ROWS; r++) {
      const y = BOARD_PADDING + r * CELL
      lines.push(<line key={`h${r}`} x1={BOARD_PADDING} y1={y} x2={BOARD_WIDTH - BOARD_PADDING} y2={y} stroke="#8B5A2B" strokeWidth="1.5" />)
    }
    for (let c = 0; c < BOARD_COLS; c++) {
      const x = BOARD_PADDING + c * CELL
      lines.push(<line key={`vt${c}`} x1={x} y1={BOARD_PADDING} x2={x} y2={BOARD_PADDING + 4 * CELL} stroke="#8B5A2B" strokeWidth="1.5" />)
      lines.push(<line key={`vb${c}`} x1={x} y1={BOARD_PADDING + 5 * CELL} x2={x} y2={BOARD_PADDING + 9 * CELL} stroke="#8B5A2B" strokeWidth="1.5" />)
    }
    const diags = [[3, 0, 5, 2], [5, 0, 3, 2], [3, 7, 5, 9], [5, 7, 3, 9]]
    diags.forEach(([x1, y1, x2, y2], i) => {
      lines.push(<line key={`d${i}`} x1={BOARD_PADDING + x1 * CELL} y1={BOARD_PADDING + y1 * CELL} x2={BOARD_PADDING + x2 * CELL} y2={BOARD_PADDING + y2 * CELL} stroke="#8B5A2B" strokeWidth="1.5" />)
    })
    return lines
  }, [])

  // ── 棋子 ──
  const pieces = React.useMemo(() => {
    const nodes: React.ReactNode[] = []
    for (let c = 0; c < BOARD_COLS; c++) {
      for (let r = 0; r < BOARD_ROWS; r++) {
        const piece = board.board[c][r]
        if (piece === '.') continue
        // 动画期间隐藏目标位置的静态棋子
        if (anim && lastMove && c === lastMove.to.col && r === lastMove.to.row) continue
        const { x, y } = posToSvg({ col: c, row: r }, boardFlipped, grid)
        const isSel = selected?.col === c && selected?.row === r
        const isCheck = kingPos?.col === c && kingPos?.row === r
        const color = isRed(piece) ? 'red' : 'black'
        const skinFile = pieceSkin ? `${pieceSkin}/${pieceSkinFile(piece)}.webp` : null
        nodes.push(
          <g key={`p${c}${r}`} className={isSel ? 'piece-lift' : undefined}>
            {isCheck && <circle cx={x} cy={y} r={PIECE_RADIUS + 6} fill="none" stroke="#e74c3c" strokeWidth="3" opacity="0.8">
              <animate attributeName="r" values={`${PIECE_RADIUS + 4};${PIECE_RADIUS + 8};${PIECE_RADIUS + 4}`} dur="1s" repeatCount="indefinite" />
            </circle>}
            {isSel && <circle cx={x} cy={y} r={PIECE_RADIUS + 4} fill="rgba(0,150,255,0.3)" stroke="#4a9eff" strokeWidth="2" />}
            {skinFile ? (
              <image href={skinFile} x={x - PIECE_RADIUS} y={y - PIECE_RADIUS} width={PIECE_RADIUS * 2} height={PIECE_RADIUS * 2}
                style={{ pointerEvents: 'none' }} />
            ) : (
              <>
                <circle cx={x} cy={y} r={PIECE_RADIUS} fill={color === 'red' ? '#f8e8c8' : '#2c2c2c'} stroke={color === 'red' ? '#c41e1e' : '#666'} strokeWidth="2.5" />
                <circle cx={x} cy={y} r={PIECE_RADIUS - 5} fill="none" stroke={color === 'red' ? '#c41e1e' : '#777'} strokeWidth="1" />
                <text x={x} y={y + 8} textAnchor="middle" fontSize="26" fontWeight="bold" fill={color === 'red' ? '#c41e1e' : '#eee'} style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {GLYPHS[piece]}
                </text>
              </>
            )}
          </g>
        )
      }
    }
    return nodes
  }, [board, selected, lastMove, boardFlipped, kingPos, anim, pieceSkin, grid])

  // ── 上一手标记：起点虚线圈（空格也可见）+ 落点棋子高亮环 ──
  const lastMoveMarks = React.useMemo(() => {
    if (!lastMove) return null
    const from = posToSvg(lastMove.from, boardFlipped, grid)
    const to = posToSvg(lastMove.to, boardFlipped, grid)
    return (
      <g>
        <circle cx={from.x} cy={from.y} r={PIECE_RADIUS - 6} fill="none"
          stroke="#16a34a" strokeWidth="2.5" strokeDasharray="6 4" opacity="0.95" />
        <circle cx={to.x} cy={to.y} r={PIECE_RADIUS + 5} fill="rgba(22,163,74,0.28)"
          stroke="#16a34a" strokeWidth="3" />
      </g>
    )
  }, [lastMove, boardFlipped, grid])

  // ── 合法走法标记 ──
  const targetMarks = React.useMemo(() =>
    settings.showLegalMoves ? legalTargets.map((pos, i) => {
      const { x, y } = posToSvg(pos, boardFlipped, grid)
      return board.board[pos.col][pos.row] !== '.' ? (
        <circle key={i} cx={x} cy={y} r={PIECE_RADIUS + 4} fill="none" stroke="#e74c3c" strokeWidth="2.5" strokeDasharray="6 3" />
      ) : (
        <circle key={i} cx={x} cy={y} r="9" fill="rgba(76,175,80,0.4)" />
      )
    }) : []
  , [legalTargets, board, boardFlipped, settings.showLegalMoves, grid])

   // ── 提示箭头（天天象棋风格：起点编号 + 圆头粗线 + 三角箭头）──
   const hintArrows = React.useMemo(() => {
     const moves = hintInfo?.movesUci
     if (!moves || moves.length === 0) return null
     return moves.map((uci, i) => {
       const fromPos = { col: uci.charCodeAt(0) - 97, row: Number(uci[1]) }
       const toPos = { col: uci.charCodeAt(2) - 97, row: Number(uci[3]) }
       return arrowGeometry(
         posToSvg(fromPos, boardFlipped, grid),
         posToSvg(toPos, boardFlipped, grid),
         i + 1,
       )
     })
   }, [hintInfo, boardFlipped, grid])

   // ── AI 思考中实时最优箭头（橙色流动虚线，随搜索加深更新，仿天天象棋动态提示）──
   const aiArrow = React.useMemo(() => {
     if (!aiPreview || mode !== 'play' || !aiPreview.move || aiPreview.move.length < 4) return null
     const fromPos = { col: aiPreview.move.charCodeAt(0) - 97, row: Number(aiPreview.move[1]) }
     const toPos = { col: aiPreview.move.charCodeAt(2) - 97, row: Number(aiPreview.move[3]) }
     return arrowGeometry(posToSvg(fromPos, boardFlipped, grid), posToSvg(toPos, boardFlipped, grid), 0)
   }, [aiPreview, mode, boardFlipped, grid])

   // ── 复盘：最后一手的评级角标（正/妙/软/次/劣/漏）──
   const boardTag = React.useMemo(() => {
     if (mode !== 'replay' || currentPlyIndex <= 0 || !lastMove) return null
     const tag = moveTag(game.plies[currentPlyIndex - 1]?.analysis?.classification)
     if (!tag) return null
     const to = posToSvg(lastMove.to, boardFlipped, grid)
     return { tag, x: to.x, y: to.y }
   }, [mode, currentPlyIndex, lastMove, game, boardFlipped, grid])

  return (
    <div className="board-container">
      {isPlay ? (
        <>
          <EvalBar />
          <div className={`player-info ${topSide === 'w' ? 'red-info' : 'black-info'}`}>
            <span className="player-name">{board.turn === topSide ? '● ' : ''}{sideLabel(topSide)}</span>
            <span className="timer">{formatTime(sideTime(topSide))}</span>
          </div>
        </>
      ) : !isMobile ? (
        <div className="player-bar">
          <span className="player-side">
            <span className="player-name">{board.turn === 'b' ? '● ' : ''}黑方（{blackRole}）</span>
            <span className="timer">{formatTime(blackTime)}</span>
          </span>
          <span className="vs">vs</span>
          <span className="player-side">
            <span className="player-name">{board.turn === 'w' ? '● ' : ''}红方（{redRole}）</span>
            <span className="timer">{formatTime(redTime)}</span>
          </span>
        </div>
      ) : mode === 'replay' && !variation ? (
        // 复盘也常显评估条（有整盘分析/预分析数据时显示该局面分数）
        <EvalBar />
      ) : null}
      <svg ref={svgRef} width={BOARD_WIDTH} height={BOARD_HEIGHT} viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        style={{ touchAction: 'none', cursor: 'pointer' }}>
        <rect x="0" y="0" width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#e8c87e" rx="8" />
        <defs>
          <filter id="arrowShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.35" />
          </filter>
        </defs>
        {boardSkin && <image href={boardSkin} x="0" y="0" width={BOARD_WIDTH} height={BOARD_HEIGHT} rx="8" preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />}
        {/* 棋盘皮肤已自带网格与「楚河 汉界」，仅在经典（无皮肤）样式下叠加绘制 SVG 网格，
           否则会与皮肤网格重叠产生「双线」且因 slice 裁切导致越偏越大 */}
        {!boardSkin && <text x={BOARD_WIDTH / 2} y={BOARD_PADDING + 4.5 * CELL + 16} textAnchor="middle" fontSize="22" fill="#8B5A2B" letterSpacing="18" style={{ userSelect: 'none' }}>楚河 汉界</text>}
        {!boardSkin && gridLines}{lastMoveMarks}{targetMarks}{pieces}
        {boardTag && (
          <g className="board-move-tag" pointerEvents="none">
            <circle cx={boardTag.x + 24} cy={boardTag.y - 24} r="13" fill="rgba(18,18,26,0.82)" />
            <text className={boardTag.tag.c} x={boardTag.x + 24} y={boardTag.y - 19}
              textAnchor="middle" fontSize="14" fontWeight="700">{boardTag.tag.t}</text>
          </g>
        )}
        {aiArrow && (
          <g className="ai-arrow" pointerEvents="none">
            <path className="ai-arrow-path" d={aiArrow.path} fill="#f5a623" fillOpacity="0.9" filter="url(#arrowShadow)" />
          </g>
        )}
        {hintArrows && (
          <g className="hint-arrows" pointerEvents="none">
            {hintArrows.map((a, i) => (
              <path key={`arrow-${i}`} d={a.path} fill="#22c55e" fillOpacity="0.88" filter="url(#arrowShadow)" />
            ))}
          </g>
        )}
        {anim && (() => {
          const color = isRed(anim.piece) ? 'red' : 'black'
          const glyph = GLYPHS[anim.piece] || '?'
          const skinFile = pieceSkin ? `${pieceSkin}/${pieceSkinFile(anim.piece)}.webp` : null
          return (
            <g
              className="piece-anim"
              style={{ '--dx': `${anim.dx}px`, '--dy': `${anim.dy}px` } as React.CSSProperties}
              onAnimationEnd={() => setAnim(null)}
            >
              {skinFile ? (
                <image href={skinFile} x={anim.fromX - PIECE_RADIUS} y={anim.fromY - PIECE_RADIUS}
                  width={PIECE_RADIUS * 2} height={PIECE_RADIUS * 2} style={{ pointerEvents: 'none' }} />
              ) : (
                <>
                  <circle cx={anim.fromX} cy={anim.fromY} r={PIECE_RADIUS}
                    fill={color === 'red' ? '#f8e8c8' : '#2c2c2c'}
                    stroke={color === 'red' ? '#c41e1e' : '#666'} strokeWidth="2.5" />
                  <circle cx={anim.fromX} cy={anim.fromY} r={PIECE_RADIUS - 5}
                    fill="none" stroke={color === 'red' ? '#c41e1e' : '#777'} strokeWidth="1" />
                  <text x={anim.fromX} y={anim.fromY + 8} textAnchor="middle" fontSize="26"
                    fontWeight="bold" fill={color === 'red' ? '#c41e1e' : '#eee'}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}>
                    {glyph}
                  </text>
                </>
              )}
            </g>
          )
        })()}
      </svg>
      {isPlay && (
        <div className={`player-info ${bottomSide === 'w' ? 'red-info' : 'black-info'}`}>
          <span className="player-name">{board.turn === bottomSide ? '● ' : ''}{sideLabel(bottomSide)}</span>
          <span className="timer">{formatTime(sideTime(bottomSide))}</span>
        </div>
      )}
      {/* AI 思考中实时最优：覆在棋盘左上，随搜索加深更新（不占布局、不挡棋盘交互） */}
      {aiPreview && mode === 'play' && (
        <div className="board-live-best" title="AI 思考中实时最优着（随搜索加深更新，分数为 AI 方视角）">
          <span className="blb-pulse" />
          <span className="blb-move">{chineseFromFen(boardToFen(board), aiPreview.move)}</span>
          <span className="blb-meta">d{aiPreview.depth}</span>
          <span className={`blb-score ${aiPreview.score < 0 ? 'blb-neg' : ''}`}>
            {(aiPreview.score / 100 >= 0 ? '+' : '') + (aiPreview.score / 100).toFixed(2)}
          </span>
        </div>
      )}
      {hintInfo && (
        <div className="board-hint-overlay">
          💡 推荐 {hintInfo.line.join(' → ')}
          <span className="board-hint-score" title="行棋方视角的评估（正分=走这步后我方占优）">
            {(hintInfo.score / 100 >= 0 ? '+' : '') + (hintInfo.score / 100).toFixed(2)}（我方）
          </span>
        </div>
      )}
    </div>
  )
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
