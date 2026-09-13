/**
 * 抓取"天天象棋残局挑战"历史棋谱（东萍象棋网棋友上传）
 *
 * 用法: npm run challenges
 *
 * 数据源: dpxq.com 搜索 owner=棋友上传 & title=天天象棋残局挑战
 *   - 详情页 DhtmlXQ_binit 为 32 组坐标（固定棋子顺序，99=空位），转成 FEN
 *   - 页面按 GBK 编码；结果缓存 .cache/dpxq-weekly/ 便于重跑
 * 产物: public/weekly-challenges.json  { source, generatedAt, count, items: [{ n, date, title, fen }] }
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CACHE = join(ROOT, '.cache', 'dpxq-weekly')
const OUT = join(ROOT, 'public', 'weekly-challenges.json')

const PIECES = 'RNBAKABNRCCPPPPP' + 'rnbakabnrccppppp'
const START_BINIT = '8979695949392919097717866646260600102030405060708012720323436383'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

mkdirSync(CACHE, { recursive: true })

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// dpxq 搜索分页依赖 ASP session cookie（无 cookie 时每次都是第 1 页）
let cookie = ''

/** 带缓存/Cookie 的 GBK 页面抓取（503 时退避重试） */
async function fetchGbk(url, cacheName) {
  const file = join(CACHE, cacheName)
  if (existsSync(file)) return readFileSync(file)
  let lastErr = new Error('unknown fetch error')
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const headers = { 'User-Agent': UA }
      if (cookie) headers.Cookie = cookie
      const res = await fetch(url, { headers })
      if (res.status === 503 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}（限流）`)
        await sleep(2500 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const setCookies = res.headers.getSetCookie?.() ?? []
      for (const sc of setCookies) {
        const pair = sc.split(';')[0]
        const name = pair.split('=')[0]
        cookie = cookie.split('; ').filter(c => c && !c.startsWith(name + '=')).concat(pair).join('; ')
      }
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(file, buf)
      await sleep(350)
      return buf
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      await sleep(1000 * (attempt + 1))
    }
  }
  throw lastErr
}

const gbk = buf => new TextDecoder('gbk').decode(buf)

/** binit（32 组 xy，99=空）→ 应用 FEN（y=0 黑方底线） */
function binitToFen(binit) {
  const raw = ((binit || '').replace(/\D/g, '9') + START_BINIT).slice(0, 64)
  const s = raw.replace(/(\d\d)/g, '_$1').replace(/_9[0-8]/g, '_99').replace(/_/g, '')
  const board = Array.from({ length: 10 }, () => Array(9).fill('.'))
  for (let k = 0; k < 32; k++) {
    const x = Number(s[2 * k])
    const y = Number(s[2 * k + 1])
    if (x > 8 || y > 9) continue
    board[y][x] = PIECES[k]
  }
  const rows = board.map(r => r.join('').replace(/\.+/g, n => String(n.length)))
  const fen = rows.join('/') + ' w'
  // 基本合法性：每行 9 格、双方各一将
  if (rows.some(r => r.replace(/\d/g, '').length + r.replace(/\D/g, '').split('').reduce((a, b) => a + Number(b), 0) !== 9)) return null
  const flat = rows.join('')
  if ((flat.match(/K/g) || []).length !== 1 || (flat.match(/k/g) || []).length !== 1) return null
  return fen
}

function field(html, name) {
  const m = html.match(new RegExp(`\\[${name}\\]([^\\[]*)\\[\\/${name}\\]`))
  return m ? m[1].trim() : ''
}

async function main() {
  const entries = new Map() // n -> { id, title }
  // GBK 百分号编码（固定查询词，避免依赖系统 iconv）
  const OWNER = '%C6%E5%D3%D1%C9%CF%B4%AB' // 棋友上传
  const TITLE = '%CC%EC%CC%EC%CF%F3%C6%E5%B2%D0%BE%D6%CC%F4%D5%BD' // 天天象棋残局挑战
  // 三个棋库都搜一遍（早期上传可能在无主棋谱/象棋谱大全）
  const LIBRARIES = [
    ['%C6%E5%D3%D1%C9%CF%B4%AB', 'qiyou'],   // 棋友上传
    ['%CE%DE%D6%F7%C6%E5%C6%D7', 'wuzhu'],   // 无主棋谱
    ['%CF%F3%C6%E5%C6%D7%B4%F3%C8%AB', 'daquan'], // 象棋谱大全
  ]
  for (const [owner, tag] of LIBRARIES) {
    let idlePages = 0
    for (let page = 1; page <= 120; page++) {
      const url = `http://dpxq.com/hldcg/search/search.asp?owner=${owner}&title=${TITLE}&page=${page}`
      const html = gbk(await fetchGbk(url, `search-${tag}-${page}.html`))
      const rows = [...html.matchAll(/view\('owner=u&id=(\d+)[^']*'\)[^>]*>([^<]+)</g)]
      if (rows.length === 0) break
      let added = 0
      for (const [, id, rawTitle] of rows) {
        const n = Number((rawTitle.match(/第\s*(\d+)\s*期/) || [])[1])
        if (!n) continue
        const cur = entries.get(n) ?? { ids: [], title: rawTitle.trim() }
        if (!cur.ids.includes(id)) { cur.ids.push(id); added++ }
        entries.set(n, cur)
      }
      idlePages = added === 0 ? idlePages + 1 : 0
      if (idlePages >= 8) break
      if (added > 0) console.log(`[challenges] ${tag} 第 ${page} 页：新增 ${added}，累计 ${entries.size}`)
    }
  }

  const items = []
  const nums = [...entries.keys()].sort((a, b) => a - b)
  for (const n of nums) {
    const { ids, title } = entries.get(n)
    let fen = null
    let date = ''
    for (const id of ids) {
      let html
      try {
        html = gbk(await fetchGbk(`http://dpxq.com/hldcg/search/view_u_${id}.html`, `view-${id}.html`))
      } catch (e) {
        console.warn(`[challenges] 第${n}期(${id}) 拉取失败: ${e?.message ?? e}`)
        continue
      }
      const parsed = binitToFen(field(html, 'DhtmlXQ_binit'))
      if (parsed) {
        fen = parsed
        date = field(html, 'DhtmlXQ_date').slice(0, 10)
        break
      }
    }
    if (!fen) { console.warn(`[challenges] 第${n}期 无有效局面，跳过`); continue }
    items.push({ n, date, title, fen })
    if (items.length % 50 === 0) console.log(`[challenges] 已解析 ${items.length}/${nums.length}`)
  }

  const out = {
    source: '东萍象棋网友上传（天天象棋残局挑战），原始对局版权归天天象棋所有，仅供个人打谱',
    generatedAt: new Date().toISOString().slice(0, 10),
    count: items.length,
    items,
  }
  writeFileSync(OUT, JSON.stringify(out))
  console.log(`[challenges] 完成：${items.length} 期（第${items[0]?.n}期 ~ 第${items[items.length - 1]?.n}期）→ ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
