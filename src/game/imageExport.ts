/**
 * 图片棋谱导出（规划第8节"以后可增加：图片棋谱"）
 *
 * 用 Canvas 渲染终局局面 + 双方信息 + 着法列表，导出 PNG。
 */

import type { Game } from './model'
import { boardFromFen } from './board'

const GLYPHS: Record<string, string> = {
  K: '帅', k: '将', A: '仕', a: '士', B: '相', b: '象',
  N: '马', n: '马', R: '车', r: '车', C: '炮', c: '炮', P: '兵', p: '卒',
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

export interface ExportImageOpts {
  /** 导出第 plyIndex 手之后的局面（默认 = 终局） */
  plyIndex?: number
  /** 'share' 优先走系统分享（Web Share API，移动端），失败/不支持回退下载 */
  mode?: 'download' | 'share'
}

export async function exportGameImage(game: Game, opts: ExportImageOpts = {}): Promise<void> {
  const total = game.plies.length
  const plyIndex = Math.max(0, Math.min(opts.plyIndex ?? total, total))
  const partial = plyIndex < total

  const S = 74                 // 格距
  const PAD_X = 46             // 棋盘左右留白
  const BOARD_TOP = 108        // 棋盘顶
  const BOARD_W = 8 * S
  const BOARD_H = 9 * S
  const MOVES_AREA = Math.min(220, 26 * Math.ceil(plyIndex / 2 / 4) + 40)
  const W = BOARD_W + PAD_X * 2
  const H = BOARD_TOP + BOARD_H + 34 + MOVES_AREA

  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!

  // ── 背景 ──
  g.fillStyle = '#22223a'
  g.fillRect(0, 0, W, H)

  // ── 标题区 ──
  const red = game.header.Red || '红方'
  const black = game.header.Black || '黑方'
  const resultText = partial
    ? `第 ${Math.ceil(plyIndex / 2)} 回合局面`
    : game.result === '1-0' ? '红胜' : game.result === '0-1' ? '黑胜' : game.result === '1/2-1/2' ? '和棋' : '未结束'
  g.textAlign = 'center'
  g.fillStyle = '#e05555'
  g.font = 'bold 26px "PingFang SC", "Microsoft YaHei", sans-serif'
  g.fillText(red, W * 0.28, 48)
  g.fillStyle = '#f0c94a'
  g.fillText(' ⚔ ', W / 2, 48)
  g.fillStyle = '#6aa5e8'
  g.fillText(black, W * 0.72, 48)

  g.fillStyle = '#a0a0b8'
  g.font = '15px sans-serif'
  const date = game.header.Date || new Date(game.createdAt).toISOString().slice(0, 10)
  g.fillText(`${resultText} · 共 ${Math.ceil(total / 2)} 回合 · ${date}`, W / 2, 78)

  // ── 棋盘木底 ──
  const bx = PAD_X - 26
  const by = BOARD_TOP - 26
  g.fillStyle = '#e8c87e'
  roundRect(g, bx, by, BOARD_W + 52, BOARD_H + 52, 10)
  g.fill()

  // ── 网格 ──
  const px = (col: number) => PAD_X + col * S
  const py = (row: number) => BOARD_TOP + (9 - row) * S
  g.strokeStyle = '#8B5A2B'
  g.lineWidth = 1.5

  for (let r = 0; r < 10; r++) {
    g.beginPath(); g.moveTo(px(0), py(r)); g.lineTo(px(8), py(r)); g.stroke()
  }
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) {
      g.beginPath(); g.moveTo(px(c), py(0)); g.lineTo(px(c), py(9)); g.stroke()
    } else {
      g.beginPath(); g.moveTo(px(c), py(0)); g.lineTo(px(c), py(4)); g.stroke()
      g.beginPath(); g.moveTo(px(c), py(5)); g.lineTo(px(c), py(9)); g.stroke()
    }
  }
  // 九宫斜线
  const diags = [[3, 0, 5, 2], [5, 0, 3, 2], [3, 9, 5, 7], [5, 9, 3, 7]]
  for (const [x1, y1, x2, y2] of diags) {
    g.beginPath(); g.moveTo(px(x1), py(y1)); g.lineTo(px(x2), py(y2)); g.stroke()
  }

  // 楚河汉界
  g.fillStyle = '#8B5A2B'
  g.font = '22px "PingFang SC", serif'
  g.fillText('楚 河        汉 界', W / 2, py(4) + (py(5) - py(4)) / 2 + 8)

  // ── 棋子 ──
  const finalState = boardFromFen(
    plyIndex > 0 ? game.plies[plyIndex - 1].fenAfter : game.startFen,
  )
  const R = S * 0.42
  for (let c = 0; c < 9; c++) {
    for (let r = 0; r < 10; r++) {
      const piece = finalState.board[c][r]
      if (piece === '.') continue
      const x = px(c), y = py(r)
      const isRedPiece = piece === piece.toUpperCase()
      g.beginPath()
      g.arc(x, y, R, 0, Math.PI * 2)
      g.fillStyle = isRedPiece ? '#f8e8c8' : '#2c2c2c'
      g.fill()
      g.lineWidth = 2.5
      g.strokeStyle = isRedPiece ? '#c41e1e' : '#666'
      g.stroke()
      g.beginPath()
      g.arc(x, y, R - 5, 0, Math.PI * 2)
      g.lineWidth = 1
      g.stroke()
      g.fillStyle = isRedPiece ? '#c41e1e' : '#eee'
      g.font = `bold ${Math.round(R)}px "PingFang SC", sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(GLYPHS[piece] || '?', x, y + 1)
      g.textBaseline = 'alphabetic'
    }
  }

  // ── 着法列表 ──
  let my = BOARD_TOP + BOARD_H + 52
  g.textAlign = 'left'
  g.fillStyle = '#a0a0b8'
  g.font = '13px sans-serif'
  g.fillText('着法:', PAD_X, my - 24)

  g.font = '15px "PingFang SC", sans-serif'
  const perLine = 4 // 每行 4 个回合
  const rounds = Math.ceil(plyIndex / 2)
  const shownRounds = Math.min(rounds, perLine * 6)
  for (let rd = 0; rd < shownRounds; rd++) {
    const colIdx = rd % perLine
    const rowIdx = Math.floor(rd / perLine)
    const x = PAD_X + colIdx * ((W - PAD_X * 2) / perLine)
    const y = my + rowIdx * 24
    const red_ = game.plies[rd * 2]?.moveCn ?? '…'
    const black_ = game.plies[rd * 2 + 1]?.moveCn ?? ''
    g.fillStyle = '#666'
    g.fillText(`${rd + 1}.`, x, y)
    g.fillStyle = '#ddd'
    g.fillText(`${red_} ${black_}`.trim(), x + 28, y)
  }
  if (rounds > shownRounds) {
    g.fillStyle = '#888'
    g.fillText(`……共 ${rounds} 回合`, PAD_X, my + Math.ceil(shownRounds / perLine) * 24 + 6)
  }

  // ── 输出：系统分享（Web Share API）或下载 ──
  const blob = await new Promise<Blob>((resolve) =>
    cv.toBlob((b) => resolve(b!), 'image/png'),
  )
  const filename = `xiangqi_${game.id}${partial ? `_ply${plyIndex}` : ''}.png`

  if (opts.mode === 'share') {
    try {
      const file = new File([blob], filename, { type: 'image/png' })
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>
      }
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: red + ' ⚔ ' + black, text: resultText })
        return
      }
    } catch (e) {
      // 用户取消或其他错误 → 回退下载
      if ((e as DOMException)?.name === 'AbortError') return
      console.warn('系统分享失败，回退下载:', e)
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── 关键时刻九宫格 ────────────────────────────────────────────────

export interface MomentShot {
  /** 第几手（0 基，局面取该手之后的 fenAfter） */
  ply: number
  /** 角标文字，如「漏」「妙」 */
  tag?: string
  /** 角标颜色 */
  tagColor?: string
  /** 说明，如「第 12 回合 · 炮二平五」 */
  label: string
}

/** 在画布上画一个小棋盘（含棋子），供九宫格复用 */
function drawMiniBoard(g: CanvasRenderingContext2D, state: ReturnType<typeof boardFromFen>, x: number, y: number, step: number) {
  const gw = 8 * step
  const gh = 9 * step
  g.fillStyle = '#e8c87e'
  roundRect(g, x - step * 0.45, y - step * 0.45, gw + step * 0.9, gh + step * 0.9, 8)
  g.fill()

  const px = (c: number) => x + c * step
  const py = (r: number) => y + (9 - r) * step
  g.strokeStyle = '#8B5A2B'
  g.lineWidth = 1
  for (let r = 0; r < 10; r++) {
    g.beginPath(); g.moveTo(px(0), py(r)); g.lineTo(px(8), py(r)); g.stroke()
  }
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) {
      g.beginPath(); g.moveTo(px(c), py(0)); g.lineTo(px(c), py(9)); g.stroke()
    } else {
      g.beginPath(); g.moveTo(px(c), py(0)); g.lineTo(px(c), py(4)); g.stroke()
      g.beginPath(); g.moveTo(px(c), py(5)); g.lineTo(px(c), py(9)); g.stroke()
    }
  }
  for (const [x1, y1, x2, y2] of [[3, 0, 5, 2], [5, 0, 3, 2], [3, 9, 5, 7], [5, 9, 3, 7]]) {
    g.beginPath(); g.moveTo(px(x1), py(y1)); g.lineTo(px(x2), py(y2)); g.stroke()
  }

  const R = step * 0.43
  for (let c = 0; c < 9; c++) {
    for (let r = 0; r < 10; r++) {
      const piece = state.board[c][r]
      if (piece === '.') continue
      const cx = px(c), cy = py(r)
      const isRed = piece === piece.toUpperCase()
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2)
      g.fillStyle = '#f8eccd'; g.fill()
      g.lineWidth = 1.6
      g.strokeStyle = isRed ? '#b3261e' : '#33302a'; g.stroke()
      g.beginPath(); g.arc(cx, cy, R - Math.max(1.5, step * 0.06), 0, Math.PI * 2)
      g.lineWidth = 0.8; g.strokeStyle = isRed ? 'rgba(179,38,30,0.55)' : 'rgba(51,48,42,0.55)'; g.stroke()
      g.fillStyle = isRed ? '#b3261e' : '#26221d'
      g.font = `${Math.round(step * 0.62)}px "PingFang SC", "Microsoft YaHei", serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(GLYPHS[piece] || '?', cx, cy + 1)
      g.textBaseline = 'alphabetic'
    }
  }
}

/** 导出「关键时刻九宫格」分享图（最多 9 个局面） */
export async function exportMomentsImage(game: Game, shots: MomentShot[], opts: { mode?: 'download' | 'share' } = {}): Promise<void> {
  const items = shots.slice(0, 9)
  if (!items.length) return

  const W = 1080
  const M = 40
  const GAP = 22
  const COLS = 3
  const cellW = (W - M * 2 - GAP * (COLS - 1)) / COLS
  const step = cellW / 9.1
  const boardH = 9 * step
  const cellH = boardH + step * 1.4 + 54
  const rows = Math.ceil(items.length / COLS)
  const HEAD = 112
  const H = HEAD + rows * cellH + (rows - 1) * GAP + M

  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!

  g.fillStyle = '#1b1b2b'
  g.fillRect(0, 0, W, H)

  // 标题
  g.textAlign = 'center'
  g.fillStyle = '#f0c94a'
  g.font = 'bold 38px "PingFang SC", "Microsoft YaHei", sans-serif'
  g.fillText('关键时刻 · 九宫格', W / 2, 58)
  const red = game.header.Red || '红方'
  const black = game.header.Black || '黑方'
  const resultText = game.result === '1-0' ? '红胜' : game.result === '0-1' ? '黑胜' : game.result === '1/2-1/2' ? '和棋' : ''
  g.fillStyle = '#a0a0b8'
  g.font = '22px "PingFang SC", sans-serif'
  g.fillText(`${red} vs ${black}${resultText ? ' · ' + resultText : ''} · 共 ${Math.ceil(game.plies.length / 2)} 回合`, W / 2, 92)

  items.forEach((s, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const cx = M + col * (cellW + GAP)
    const cy = HEAD + row * (cellH + GAP)

    // 标签
    g.textAlign = 'left'
    g.fillStyle = '#d8d8e8'
    g.font = '21px "PingFang SC", sans-serif'
    g.fillText(s.label, cx + 4, cy + 22)

    // 角标
    if (s.tag) {
      g.textAlign = 'right'
      g.fillStyle = s.tagColor || '#f0c94a'
      g.font = 'bold 21px "PingFang SC", sans-serif'
      g.fillText(s.tag, cx + cellW - 4, cy + 22)
    }

    const state = boardFromFen(
      s.ply >= 0 && s.ply < game.plies.length ? game.plies[s.ply].fenAfter : game.startFen,
    )
    drawMiniBoard(g, state, cx + step * 0.45, cy + 34 + step * 0.45, step)
  })

  const blob = await new Promise<Blob>((resolve) => cv.toBlob((b) => resolve(b!), 'image/png'))
  const filename = `xiangqi_moments_${game.id}.png`

  if (opts.mode === 'share') {
    try {
      const file = new File([blob], filename, { type: 'image/png' })
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>
      }
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: '关键时刻 · 九宫格', text: `${red} vs ${black}` })
        return
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return
      console.warn('系统分享失败，回退下载:', e)
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
