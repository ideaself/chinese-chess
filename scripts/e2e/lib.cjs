/**
 * E2E 冒烟测试共享库
 *
 * 通过 CDP (Chrome DevTools Protocol) 驱动无头 Chromium。
 * 前置: npm run build && npm run preview 已由 run.cjs 拉起。
 */
const http = require('http')

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = ''
      r.on('data', c => d += c)
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
    }).on('error', rej)
  })
}

/** 连接页面并返回操作上下文 */
async function connect(port = 9222) {
  const targets = await getJson(`http://localhost:${port}/json/list`)
  const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('未找到页面 target，Chrome 是否已带 URL 启动？')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pending = new Map()
  const logs = []

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ')
      logs.push(`[${msg.params.type}] ${text}`)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      logs.push(`[exception] ${d?.exception?.description || d?.text || 'unknown'}`)
    }
  }

  await send('Runtime.enable')
  await send('Page.enable')

  function send(method, params = {}) {
    return new Promise(res => {
      const i = ++id
      pending.set(i, res)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  }

  async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) {
      throw new Error('EVAL: ' + (r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)))
    }
    return r.result?.result?.value
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  /** 断言辅助 */
  const results = { pass: 0, fail: 0 }
  function check(name, cond, detail = '') {
    if (cond) results.pass++
    else { results.fail++; console.log(`   FAIL: ${name} ${detail}`) }
  }

  return { send, evalJs, sleep, check, results, logs }
}

/** 等待引擎就绪（最多 90s） */
async function waitEngineReady(ctx) {
  for (let i = 0; i < 30; i++) {
    await ctx.sleep(3000)
    if (await ctx.evalJs(`!!document.querySelector('.status-ready')`)) return true
  }
  return false
}

module.exports = { getJson, connect, waitEngineReady }
