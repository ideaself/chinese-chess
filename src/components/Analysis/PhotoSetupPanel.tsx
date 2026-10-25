/**
 * 拍照摆棋：选照片 → 拖四角 → 识别 → 应用到摆棋（默认红先，可改黑先）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PieceChar, Turn } from '../../game/board'
import {
  BOARD_IMG_H, BOARD_IMG_W, GRID_CELL, GRID_PAD,
  recognizeBoard, warpBoard, type Corners, type Pt,
} from '../../game/photoBoard'

const GLYPH: Record<string, string> = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
}

export interface PhotoSetupPanelProps {
  onClose: () => void
  onApply: (grid: PieceChar[][], turn: Turn) => void
}

const DEFAULT_CORNERS: Pt[] = [
  { x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 },
  { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 },
]

export function PhotoSetupPanel({ onClose, onApply }: PhotoSetupPanelProps) {
  const [src, setSrc] = useState('')
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [corners, setCorners] = useState<Pt[]>(DEFAULT_CORNERS)
  const [turn, setTurn] = useState<Turn>('w')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ cells: { piece: PieceChar | null; confidence: number }[]; grid: PieceChar[][]; count: number } | null>(null)
  const [error, setError] = useState('')
  const dragRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const loadFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      const image = new Image()
      image.onload = () => {
        setImg(image)
        setSrc(url)
        setCorners(DEFAULT_CORNERS)
        setResult(null)
        setError('')
      }
      image.src = url
    }
    reader.readAsDataURL(file)
  }, [])

  const onDrop = (e: React.DragEvent) => {
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) { e.preventDefault(); loadFile(f) }
  }

  const recognize = async () => {
    if (!img) return
    setBusy(true)
    setError('')
    try {
      // 限制源图尺寸，避免超大照片 getImageData/插值过慢
      const max = 1400
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const ctx = cv.getContext('2d')
      if (!ctx) throw new Error('canvas unavailable')
      ctx.drawImage(img, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h)
      const px: Corners = corners.map(p => ({ x: p.x * w, y: p.y * h })) as Corners
      const warped = warpBoard(data, px, BOARD_IMG_W, BOARD_IMG_H)
      setResult(recognizeBoard(warped))
    } catch (e) {
      console.error(e)
      setError('识别失败，请重试或换一张更清晰的照片')
    } finally {
      setBusy(false)
    }
  }

  const pointFromEvent = (e: React.PointerEvent): Pt => {
    const el = stageRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="photo-overlay" onClick={onClose}>
      <div className="photo-panel" onClick={e => e.stopPropagation()}>
        <div className="photo-head">
          <strong>拍照摆棋</strong>
          <button className="btn btn-sm" onClick={onClose}>关闭</button>
        </div>

        {!src && (
          <label className="photo-drop" onDrop={onDrop} onDragOver={e => e.preventDefault()}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f) }}
            />
            <span className="photo-drop-icon">📷</span>
            <span>点这里拍照或选择棋盘照片</span>
            <small>把棋子拍清楚、尽量正对棋盘；识别后可手动改</small>
          </label>
        )}

        {src && (
          <>
            <div className="photo-stage-wrap">
              <div
                ref={stageRef}
                className="photo-stage"
                style={{ aspectRatio: `${img?.naturalWidth || 4} / ${img?.naturalHeight || 3}` }}
                onPointerMove={e => {
                  if (dragRef.current === null) return
                  const p = pointFromEvent(e)
                  setCorners(prev => prev.map((q, i) => i === dragRef.current ? p : q))
                }}
                onPointerUp={() => { dragRef.current = null }}
                onPointerCancel={() => { dragRef.current = null }}
              >
                <img src={src} alt="棋盘照片" draggable={false} />
                <svg className="photo-corner-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon
                    points={corners.map(p => `${p.x * 100},${p.y * 100}`).join(' ')}
                    fill="rgba(232,96,96,0.12)"
                    stroke="rgba(232,96,96,0.9)"
                    strokeWidth="0.6"
                  />
                </svg>
                {corners.map((p, i) => (
                  <button
                    key={i}
                    className="photo-handle"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    onPointerDown={e => { e.preventDefault(); dragRef.current = i }}
                    aria-label={`角 ${i + 1}`}
                  />
                ))}
              </div>
              <div className="photo-hint">拖动四个红点，对齐棋盘的四个外角</div>
            </div>

            <div className="photo-row">
              <button className="btn btn-sm" onClick={() => { setSrc(''); setImg(null); setResult(null) }}>重新选择</button>
              <button className="btn btn-sm btn-primary" onClick={recognize} disabled={busy}>
                {busy ? '识别中…' : '识别棋子'}
              </button>
            </div>
          </>
        )}

        {error && <div className="photo-error">{error}</div>}

        {result && (
          <div className="photo-result">
            <div className="photo-result-head">
              识别到 <strong>{result.count}</strong> 个棋子 · 低置信度会标黄，可在摆棋里改
            </div>
            <div className="photo-grid">
              {Array.from({ length: 10 }, (_, r) => (
                <div className="photo-grid-row" key={r}>
                  {Array.from({ length: 9 }, (_, c) => {
                    const cell = result.cells[r * 9 + c]
                    const glyph = cell.piece ? GLYPH[cell.piece] : ''
                    const red = cell.piece ? cell.piece === cell.piece.toUpperCase() && cell.piece !== cell.piece.toLowerCase() : false
                    return (
                      <span
                        key={c}
                        className={`photo-cell${glyph ? ' has-piece' : ''}${cell.confidence < 0.45 && glyph ? ' low-conf' : ''}${red ? ' red' : ''}`}
                      >
                        {glyph}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="photo-row">
              <span className="photo-turn-label">行棋方</span>
              <button className={`btn btn-sm${turn === 'w' ? ' btn-primary' : ''}`} onClick={() => setTurn('w')}>红先</button>
              <button className={`btn btn-sm${turn === 'b' ? ' btn-primary' : ''}`} onClick={() => setTurn('b')}>黑先</button>
            </div>
            <div className="photo-row">
              <button className="btn btn-sm" onClick={() => setResult(null)}>重新识别</button>
              <button className="btn btn-sm btn-primary" onClick={() => onApply(result.grid, turn)}>
                应用并进入摆棋
              </button>
            </div>
            <div className="photo-hint">进入摆棋后可直接点格子替换/擦除，确认无误再「开始对局」</div>
          </div>
        )}
      </div>
    </div>
  )
}
