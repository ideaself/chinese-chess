/**
 * 生成应用图标：直接把 resources/app-icon.png 缩放到各尺寸
 *
 * 用法: npm run icons
 *
 * 说明:
 *   - 源图是圆角方形插画（四周有白边+白角），脚本裁到内容区并按同半径圆角做透明遮罩，
 *     避免白边/白角在启动器上露白
 *   - 面积平均重采样（大倍率缩小不糊不闪）；自适应图标前景铺满 108dp，
 *     底色取画面边缘平均色，视觉上与前景无缝
 *   - 源图放 resources/ 根目录（resources/icons/ 是 android res 的镜像，CI 会整目录拷贝，
 *     不能放非资源文件）
 * 产物: android res（本地构建）+ resources/icons（入库，CI 回填）+ public PWA 图标
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.join(__dirname, '..')
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
const ICONS_OUT = path.join(ROOT, 'resources', 'icons')
const PUBLIC = path.join(ROOT, 'public')
const SRC = path.join(ROOT, 'resources', 'app-icon.png')

const LEGACY = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 }
const FORE = { 'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432 }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// ── PNG 编解码（8bit RGB/RGBA） ───────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([head, data, crcBuf])
}
function encodePng(w, h, rgba) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = Math.round(clamp(rgba[y * stride + x], 0, 1) * 255)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, colorType = 0, bitDepth = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('仅支持 8bit RGB/RGBA PNG')
  const ch = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const rows = Buffer.alloc(h * stride)
  let rp = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++]
    for (let x = 0; x < stride; x++) {
      const left = x >= ch ? rows[y * stride + x - ch] : 0
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0
      const ul = x >= ch && y > 0 ? rows[(y - 1) * stride + x - ch] : 0
      let v = raw[rp++]
      if (filter === 1) v = (v + left) & 0xff
      else if (filter === 2) v = (v + up) & 0xff
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const p = left + up - ul
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul)
        v = (v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 0xff
      }
      rows[y * stride + x] = v
    }
  }
  const d = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = rows[i * ch] / 255
    d[i * 4 + 1] = rows[i * ch + 1] / 255
    d[i * 4 + 2] = rows[i * ch + 2] / 255
    d[i * 4 + 3] = ch === 4 ? rows[i * ch + 3] / 255 : 1
  }
  return { w, h, d }
}

// ── 缩放 ──────────────────────────────────────────────────────────
/** 源图某像素（越界钳制） */
function pixel(img, x, y) {
  const xx = clamp(Math.round(x), 0, img.w - 1)
  const yy = clamp(Math.round(y), 0, img.h - 1)
  const i = (yy * img.w + xx) * 4
  return [img.d[i], img.d[i + 1], img.d[i + 2], img.d[i + 3]]
}

/**
 * 把源图正方形区域 [rx, ry, rx+side] 面积平均缩放到 size×size。
 * mask: 'rect' | 'round' | 'none'；rect 圆角半径 = size * radiusRatio
 */
function resize(img, rx, ry, side, size, mask, radiusRatio = 0.16) {
  const out = new Float32Array(size * size * 4)
  const scale = side / size
  for (let y = 0; y < size; y++) {
    const sy0 = ry + y * scale
    const sy1 = sy0 + scale
    for (let x = 0; x < size; x++) {
      const sx0 = rx + x * scale
      const sx1 = sx0 + scale
      let r = 0, g = 0, b = 0, a = 0, wsum = 0
      const iy0 = Math.floor(sy0), iy1 = Math.min(Math.ceil(sy1), img.h)
      const ix0 = Math.floor(sx0), ix1 = Math.min(Math.ceil(sx1), img.w)
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        if (wy <= 0) continue
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0)
          if (wx <= 0) continue
          const wgt = wx * wy
          const i = (sy * img.w + sx) * 4
          r += img.d[i] * wgt
          g += img.d[i + 1] * wgt
          b += img.d[i + 2] * wgt
          a += img.d[i + 3] * wgt
          wsum += wgt
        }
      }
      if (wsum > 0) { r /= wsum; g /= wsum; b /= wsum; a /= wsum }

      let cover = 1
      if (mask === 'round') {
        const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) - size / 2
        cover = clamp(0.5 - d, 0, 1)
      } else if (mask === 'rect') {
        const rad = size * radiusRatio
        const px = Math.abs(x + 0.5 - size / 2) - (size / 2 - rad)
        const py = Math.abs(y + 0.5 - size / 2) - (size / 2 - rad)
        const qx = Math.max(px, 0), qy = Math.max(py, 0)
        const d = Math.hypot(qx, qy) - rad
        cover = clamp(0.5 - d, 0, 1)
      }
      const i = (y * size + x) * 4
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a * cover
    }
  }
  return { w: size, h: size, d: out }
}

/** 透明角用底色填实（maskable/自适应前景用） */
function flatten(img, color) {
  const d = new Float32Array(img.d)
  for (let i = 0; i < img.w * img.h; i++) {
    const a = d[i * 4 + 3]
    if (a < 1) {
      d[i * 4] = d[i * 4] * a + color[0] * (1 - a)
      d[i * 4 + 1] = d[i * 4 + 1] * a + color[1] * (1 - a)
      d[i * 4 + 2] = d[i * 4 + 2] * a + color[2] * (1 - a)
      d[i * 4 + 3] = 1
    }
  }
  return { w: img.w, h: img.h, d }
}

// ── 找内容区（去掉四周白边，量出圆角半径） ────────────────────────
function findContent(img) {
  const isWhite = (x, y) => {
    const [r, g, b] = pixel(img, x, y)
    return r > 0.955 && g > 0.955 && b > 0.955
  }
  const cx = Math.round(img.w / 2), cy = Math.round(img.h / 2)
  let top = 0, bottom = img.h - 1, left = 0, right = img.w - 1
  while (top < img.h && isWhite(cx, top)) top++
  while (bottom > 0 && isWhite(cx, bottom)) bottom--
  while (left < img.w && isWhite(left, cy)) left++
  while (right > 0 && isWhite(right, cy)) right--
  const side = Math.min(right - left + 1, bottom - top + 1)
  const rx = (left + right + 1) / 2 - side / 2
  const ry = (top + bottom + 1) / 2 - side / 2
  // 在内容首行找圆角结束位置，量出圆角半径
  let cornerX = left
  while (cornerX < img.w && isWhite(cornerX, top)) cornerX++
  const radius = cornerX - left
  return { rx, ry, side, radiusRatio: clamp(radius / side + 0.012, 0.1, 0.3) }
}

/** 内容区边缘平均色（做自适应底色） */
function edgeColor(img, box) {
  let r = 0, g = 0, b = 0, n = 0
  const inset = box.side * 0.04
  for (let i = 0; i < 64; i++) {
    const t = i / 63
    const pts = [
      [box.rx + inset + t * (box.side - 2 * inset), box.ry + inset],
      [box.rx + inset + t * (box.side - 2 * inset), box.ry + box.side - inset],
      [box.rx + inset, box.ry + inset + t * (box.side - 2 * inset)],
      [box.rx + box.side - inset, box.ry + inset + t * (box.side - 2 * inset)],
    ]
    for (const [x, y] of pts) {
      const [pr, pg, pb] = pixel(img, x, y)
      r += pr; g += pg; b += pb; n++
    }
  }
  return [r / n, g / n, b / n]
}

// ── 输出 ──────────────────────────────────────────────────────────
function writeIcon(relPath, data, alsoPublic) {
  for (const base of [RES, ICONS_OUT, ...(alsoPublic ? [PUBLIC] : [])]) {
    const p = path.join(base, relPath)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, data)
  }
}
function hex(c) {
  const f = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')
  return `#${f(c[0])}${f(c[1])}${f(c[2])}`
}

function main() {
  const img = decodePng(fs.readFileSync(SRC))
  const box = findContent(img)
  const bg = edgeColor(img, box)
  console.log(`[icons] 源图 ${img.w}x${img.h}，内容区 ${Math.round(box.side)}px，底色 ${hex(bg)}`)

  // 圆角半径与源图一致（只去掉白角，不切画面）
  const masked = (size) => resize(img, box.rx, box.ry, box.side, size, 'rect', box.radiusRatio)
  const rounded = (size) => resize(img, box.rx, box.ry, box.side, size, 'round')
  const fullBleed = (size) => flatten(resize(img, box.rx, box.ry, box.side, size, 'rect', box.radiusRatio), bg)

  let count = 0
  for (const [dir, size] of Object.entries(LEGACY)) {
    writeIcon(path.join(dir, 'ic_launcher.png'), encodePng(size, size, masked(size).d))
    writeIcon(path.join(dir, 'ic_launcher_round.png'), encodePng(size, size, rounded(size).d))
    count += 2
  }
  for (const [dir, size] of Object.entries(FORE)) {
    writeIcon(path.join(dir, 'ic_launcher_foreground.png'), encodePng(size, size, fullBleed(size).d))
    count++
  }
  writeIcon(path.join('values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex(bg)}</color>\n</resources>\n`)
  count++

  // PWA / favicon
  const pwa = [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
    ['favicon.png', 64, false],
  ]
  for (const [name, size, flat] of pwa) {
    const cv = (flat ? fullBleed : masked)(size)
    fs.mkdirSync(PUBLIC, { recursive: true })
    fs.writeFileSync(path.join(PUBLIC, name), encodePng(size, size, cv.d))
    count++
  }

  console.log(`[icons] 已生成 ${count} 个 PNG + 自适应底色 ${hex(bg)}`)
}

main()
