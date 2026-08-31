#!/usr/bin/env node
/**
 * Pikafish WebSocket Bridge Server
 *
 * 为浏览器提供原生 Pikafish 引擎的 UCI 桥接：
 *   浏览器 ←WebSocket→ 本服务 ←stdin/stdout→ pikafish.exe
 *
 * 用法：
 *   node server/pikafish-server.mjs                    # 用默认配置
 *   node server/pikafish-server.mjs --binary /path/to/pikafish
 *   node server/pikafish-server.mjs --port 3002
 *
 * 配置优先级：命令行参数 > server/config.json > 自动探测
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { WebSocketServer } from 'ws'
import net from 'node:net'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 配置加载 ──────────────────────────────────────────────────────────────────

function loadConfig() {
  const cfgPath = resolve(__dirname, 'config.json')
  let cfg = { binary: '', port: 3001, threads: 0, hash: 256 }
  if (existsSync(cfgPath)) {
    try { cfg = { ...cfg, ...JSON.parse(readFileSync(cfgPath, 'utf-8')) } } catch {}
  }
  // 命令行覆盖
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--binary' && args[i + 1]) cfg.binary = args[++i]
    if (args[i] === '--port' && args[i + 1]) cfg.port = parseInt(args[++i], 10)
    if (args[i] === '--threads' && args[i + 1]) cfg.threads = parseInt(args[++i], 10)
    if (args[i] === '--hash' && args[i + 1]) cfg.hash = parseInt(args[++i], 10)
  }
  return cfg
}

function findBinary(hint) {
  if (hint && existsSync(hint)) return hint
  // 当前目录 + 常见名称
  const candidates = [
    hint,
    'pikafish.exe', 'pikafish', './pikafish.exe', './pikafish',
    resolve(__dirname, '..', 'pikafish.exe'),
    resolve(__dirname, '..', 'pikafish'),
    resolve(__dirname, '..', 'public', 'engine', 'pikafish'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) return resolve(p)
  }
  return null
}

function isPortFree(port) {
  return new Promise((res) => {
    const srv = net.createServer().once('error', () => res(false)).once('listening', () => { srv.close(); res(true) }).listen(port)
  })
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

const cfg = loadConfig()
const binPath = findBinary(cfg.binary)

if (!binPath) {
  console.error('❌ 未找到 Pikafish 引擎二进制。')
  console.error('   请将 pikafish.exe（或 pikafish）放在项目根目录，或在 server/config.json 中配置 "binary" 路径。')
  console.error('   下载地址：https://github.com/official-pikafish/Pikafish/releases')
  process.exit(1)
}

// 验证二进制是否为有效的可执行文件（读取 ELF/MZ 头）
const binMagic = Buffer.alloc(4)
try {
  const fd = readFileSync(binPath)
  fd.copy(binMagic, 0, 0, 4)
  const magic = binMagic.toString('hex')
  const isPE = magic.startsWith('4d5a')              // MZ — Windows PE（含 UPX 压缩等变体）
  const isELF = magic.startsWith('7f454c46')         // .ELF — Linux
  const isWasm = magic.startsWith('0061736d')        // \0asm — WebAssembly
  if (!isPE && !isELF && !isWasm) {
    console.error(`⚠️  二进制文件头不识别 (magic=${magic})，可能不是有效的引擎文件`)
  } else {
    console.log(`   格式: ${isPE ? 'Windows PE' : isELF ? 'Linux ELF' : 'WebAssembly'}`)
  }
} catch (e) {
  console.error(`⚠️  无法读取二进制: ${e.message}`)
}

const THREADS = cfg.threads || Math.max(1, Math.min(os.cpus().length, 8))
const HASH = cfg.hash

console.log(`♟  Pikafish WebSocket Bridge`)
console.log(`   引擎: ${binPath}`)
console.log(`   线程: ${THREADS}  Hash: ${HASH}MB`)
console.log(`   端口: ${cfg.port}`)

const httpServer = createServer((req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  // 健康检查
  if (req.url === '/health') {
    const nnuePath = resolve(dirname(binPath), 'pikafish.nnue')
    const hasNnue = existsSync(nnuePath)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', binary: binPath, threads: THREADS, nnue: hasNnue }))
    return
  }
  res.writeHead(404)
  res.end('Not Found')
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress
  console.log(`[+] 客户端连接: ${clientIP}`)

  // 每个连接启动独立的 Pikafish 进程
  const proc = spawn(binPath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  let alive = true

  // 引擎 stdout → WebSocket（逐块日志 + 逐行转发）
  let stdoutBuf = ''
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    // 原始输出日志（方便排查启动失败）
    console.log(`[engine stdout] ${text.replace(/\n$/, '')}`)
    stdoutBuf += text
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop()
    for (const line of lines) {
      if (line.trim() && ws.readyState === 1) {
        ws.send(JSON.stringify({ line: line.trim() }))
      }
    }
  })

  // 引擎 stderr
  let stderrBuf = ''
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    console.log(`[engine stderr] ${text.replace(/\n$/, '')}`)
    stderrBuf += text
  })

  proc.on('exit', (code) => {
    // 进程退出时清空残余缓冲
    if (stdoutBuf.trim() && ws.readyState === 1) {
      ws.send(JSON.stringify({ line: stdoutBuf.trim() }))
      console.log(`[engine stdout flush] ${stdoutBuf.trim()}`)
    }
    stdoutBuf = ''
    stderrBuf = ''
    console.log(`[-] 引擎退出 code=${code} (客户端 ${clientIP})`)
    alive = false
    if (ws.readyState === 1) ws.close()
  })

  // WebSocket → 引擎 stdin
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const cmd = msg.command ?? msg.cmd ?? ''
      if (cmd && alive) {
        proc.stdin.write(cmd + '\n')
      }
    } catch {
      // 兼容纯文本模式（直接发 UCI 命令）
      const cmd = data.toString().trim()
      if (cmd && alive) {
        proc.stdin.write(cmd + '\n')
      }
    }
  })

  ws.on('close', () => {
    console.log(`[-] 客户端断开: ${clientIP}`)
    alive = false
    try { proc.kill('SIGTERM') } catch {}
  })

  ws.on('error', (err) => {
    console.error(`[!] WebSocket 错误: ${err.message}`)
    alive = false
    try { proc.kill('SIGTERM') } catch {}
  })
})

async function start() {
  if (!(await isPortFree(cfg.port))) {
    console.error(`❌ 端口 ${cfg.port} 已被占用。请修改 server/config.json 的 "port" 或用 --port 指定其他端口。`)
    process.exit(1)
  }
  httpServer.listen(cfg.port, () => {
    console.log(`✅ WebSocket 服务已启动: ws://localhost:${cfg.port}`)
    console.log(`   浏览器访问棋盘页面即可自动连接`)
  })
}

start()
