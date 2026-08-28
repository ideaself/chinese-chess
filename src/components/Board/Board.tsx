/**
 * 棋盘组件 - 点击走棋
 *
 * 纯点击交互:
 *   1. 点击己方棋子 → 选中，高亮合法走法
 *   2. 点击合法目标格 → 走棋
 *   3. 点击其他位置 → 取消选择
 */

import React, { useCallback, useRef, useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import type { Pos } from '../../game/board'
import { isRed } from '../../game/board'
import { isInCheck, findKing } from '../../game/rules'
import { useMediaQuery, MOBILE_QUERY } from '../../utils/useMediaQuery'
import { EvalBar } from './EvalBar'

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

function posToSvg(pos: Pos, flipped: boolean): { x: number; y: number } {
  const col = flipped ? (BOARD_COLS - 1 - pos.col) : pos.col
  // row 0 = 红方底线 = SVG 底部 (y 最大)
  const row = flipped ? pos.row : (BOARD_ROWS - 1 - pos.row)
  return { x: BOARD_PADDING + col * CELL, y: BOARD_PADDING + row * CELL }
}

function svgToPos(x: number, y: number, flipped: boolean): Pos {
  let col = Math.round((x - BOARD_PADDING) / CELL)
  let svgRow = Math.round((y - BOARD_PADDING) / CELL)
  // svgRow 0 = 顶部 = row 9, svgRow 9 = 底部 = row 0
  let row = flipped ? svgRow : (BOARD_ROWS - 1 - svgRow)
  if (flipped) col = BOARD_COLS - 1 - col
  return { col, row }
}

const GLYPHS: Record<string, string> = {
  K: '帅', k: '将', A: '仕', a: '士', B: '相', b: '象',
  N: '马', n: '马', R: '车', r: '车', C: '炮', c: '炮', P: '兵', p: '卒',
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
  const boardFlipped = useStore(s => s.boardFlipped)
  const selectPiece = useStore(s => s.selectPiece)
  const isThinking = useStore(s => s.isThinking)
  const mode = useStore(s => s.mode)
  const sideControl = useStore(s => s.sideControl)
  const game = useStore(s => s.game)
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

  // 走子动画：挂载即从起点播放 keyframes 到终点，结束后由 onAnimationEnd 清除
  useEffect(() => {
    if (!lastMove || mode !== 'play') { prevBoardRef.current = board.board.map(c => c.join('')).join(''); return }
    const prev = prevBoardRef.current
    const curr = board.board.map(c => c.join('')).join('')
    if (prev && prev !== curr) {
      const from = posToSvg(lastMove.from, boardFlipped)
      const to = posToSvg(lastMove.to, boardFlipped)
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
  }, [board, lastMove, boardFlipped, mode])

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
    const pos = svgToPos(coords.x, coords.y, boardFlipped)
    if (pos.col < 0 || pos.col >= BOARD_COLS || pos.row < 0 || pos.row >= BOARD_ROWS) return
    if (mode === 'setup') { setupClick(pos); return }
    // 推演/自我分析：允许点选双方棋子试走（selectPiece 内部路由到 variationTryMove）
    if (mode === 'replay' && variation) { selectPiece(pos); return }
    if (mode !== 'play') return
    selectPiece(pos)
  }, [getSvgCoords])

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
        const { x, y } = posToSvg({ col: c, row: r }, boardFlipped)
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
  }, [board, selected, lastMove, boardFlipped, kingPos, anim, pieceSkin])

  // ── 上一手标记：起点虚线圈（空格也可见）+ 落点棋子高亮环 ──
  const lastMoveMarks = React.useMemo(() => {
    if (!lastMove) return null
    const from = posToSvg(lastMove.from, boardFlipped)
    const to = posToSvg(lastMove.to, boardFlipped)
    return (
      <g>
        <circle cx={from.x} cy={from.y} r={PIECE_RADIUS - 6} fill="none"
          stroke="#16a34a" strokeWidth="2.5" strokeDasharray="6 4" opacity="0.95" />
        <circle cx={to.x} cy={to.y} r={PIECE_RADIUS + 5} fill="rgba(22,163,74,0.28)"
          stroke="#16a34a" strokeWidth="3" />
      </g>
    )
  }, [lastMove, boardFlipped])

  // ── 合法走法标记 ──
  const targetMarks = React.useMemo(() =>
    settings.showLegalMoves ? legalTargets.map((pos, i) => {
      const { x, y } = posToSvg(pos, boardFlipped)
      return board.board[pos.col][pos.row] !== '.' ? (
        <circle key={i} cx={x} cy={y} r={PIECE_RADIUS + 4} fill="none" stroke="#e74c3c" strokeWidth="2.5" strokeDasharray="6 3" />
      ) : (
        <circle key={i} cx={x} cy={y} r="9" fill="rgba(76,175,80,0.4)" />
      )
    }) : []
  , [legalTargets, board, boardFlipped, settings.showLegalMoves])

   // ── 提示箭头（天天象棋风格：带序号的三步变化线）──
   const hintArrows = React.useMemo(() => {
     const moves = hintInfo?.movesUci
     if (!moves || moves.length === 0) return null
     return moves.map((uci, i) => {
       const fromPos = { col: uci.charCodeAt(0) - 97, row: Number(uci[1]) }
       const toPos = { col: uci.charCodeAt(2) - 97, row: Number(uci[3]) }
       const from = posToSvg(fromPos, boardFlipped)
       const to = posToSvg(toPos, boardFlipped)
       const dx = to.x - from.x
       const dy = to.y - from.y
       const len = Math.hypot(dx, dy) || 1
       const ex = to.x - (dx / len) * (PIECE_RADIUS + 2)
       const ey = to.y - (dy / len) * (PIECE_RADIUS + 2)
       return { from, ex, ey, n: i + 1 }
     })
   }, [hintInfo, boardFlipped])

  return (
    <div className="board-container">
      {isPlay ? (
        <>
          <EvalBar />
          <div className="player-info black-info">
            <span className="player-name">{board.turn === 'b' ? '● ' : ''}黑方（{blackRole}）</span>
            <span className="timer">{formatTime(blackTime)}</span>
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
      ) : null}
      <svg ref={svgRef} width={BOARD_WIDTH} height={BOARD_HEIGHT} viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        onPointerDown={handlePointer}
        style={{ touchAction: 'none', cursor: 'pointer' }}>
        <rect x="0" y="0" width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#e8c87e" rx="8" />
        <defs>
          <marker id="hintArrow" markerWidth="24" markerHeight="20" refX="18" refY="9" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L20,9 L0,18 Z" fill="#16a34a" />
          </marker>
        </defs>
        {boardSkin && <image href={boardSkin} x="0" y="0" width={BOARD_WIDTH} height={BOARD_HEIGHT} rx="8" preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: 'none' }} />}
        {/* 棋盘皮肤已自带网格与「楚河 汉界」，仅在经典（无皮肤）样式下叠加绘制 SVG 网格，
           否则会与皮肤网格重叠产生「双线」且因 slice 裁切导致越偏越大 */}
        {!boardSkin && <text x={BOARD_WIDTH / 2} y={BOARD_PADDING + 4.5 * CELL + 16} textAnchor="middle" fontSize="22" fill="#8B5A2B" letterSpacing="18" style={{ userSelect: 'none' }}>楚河 汉界</text>}
        {!boardSkin && gridLines}{lastMoveMarks}{targetMarks}{pieces}
        {hintArrows && (
          <g className="hint-arrows" pointerEvents="none">
            {hintArrows.map((a, i) => (
              <g key={i}>
                <line x1={a.from.x} y1={a.from.y} x2={a.ex} y2={a.ey}
                  stroke="#16a34a" strokeWidth="9" strokeLinecap="round" markerEnd="url(#hintArrow)" opacity="0.9" />
                <circle cx={a.from.x} cy={a.from.y} r="13" fill="#16a34a" stroke="#fff" strokeWidth="2" />
                <text x={a.from.x} y={a.from.y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">{a.n}</text>
              </g>
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
        <div className="player-info red-info">
          <span className="player-name">{board.turn === 'w' ? '● ' : ''}红方（{redRole}）</span>
          <span className="timer">{formatTime(redTime)}</span>
        </div>
      )}
      {hintInfo && (
        <div className="board-hint-overlay">
          💡 推荐 {hintInfo.line.join(' → ')}
          <span className="board-hint-score">
            {(hintInfo.score / 100 >= 0 ? '+' : '') + (hintInfo.score / 100).toFixed(2)}
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
