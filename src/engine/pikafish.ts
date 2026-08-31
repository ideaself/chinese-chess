/**
 * Pikafish 引擎封装。
 *
 * - Web：引擎运行在专用 Web Worker 中（public/wasm/EngineHelperWorker.js，WASM 单线程）。
 * - Android：优先调用原生多线程二进制（Capacitor 插件 NativePikafish，独立进程），
 *   否则回退到 WASM。两者共用同一套 UCI 行协议，上层无感切换。
 * - Desktop Web：优先尝试本地 WebSocket 桥接（node server/pikafish-server.mjs），
 *   使用原生多线程 Pikafish；不可用则回退 WASM。
 */
import { Capacitor } from '@capacitor/core'

/** 取原生引擎插件（Web/未注册时为 undefined，自动回退 WASM） */
function getNativePlugin(): any {
  return (Capacitor as any).Plugins?.NativePikafish
}

/** Android 原生引擎使用的线程数：取设备核心数，封顶 8 以兼顾发热 */
function nativeThreadCount(): number {
  const cores = (navigator as any).hardwareConcurrency || 4
  return Math.max(1, Math.min(cores, 8))
}

export interface EngineOptions {
  depth?: number
  threads?: number
  hash?: number
  wasmPath?: string
  /** 原生引擎不可用、回退 WASM 时回调（用于提示用户） */
  fallbackNotice?: (msg: string) => void
}

export interface EngineInfo {
  depth: number
  score: number
  move: string
  pv: string[]
  /** MultiPV 序号（从1开始） */
  multipv?: number
  /** 已搜索节点数 */
  nodes?: number
  /** 节点/秒 */
  nps?: number
}

export type EngineStatus = 'idle' | 'thinking' | 'ready'

const WORKER_URL = '/wasm/EngineHelperWorker.js'

export class PikafishEngine {
  private worker: Worker | null = null
  private status: EngineStatus = 'idle'
  private onBestMoveCallback: ((move: string) => void) | null = null
  private onInfoCallback: ((info: EngineInfo) => void) | null = null
  private isInitialized = false
  private depth: number
  private uciOkResolve: (() => void) | null = null
  /** init 进行中的 Promise（防止 StrictMode 双挂载重复起引擎） */
  private initPromise: Promise<void> | null = null
  private useNative = false
  private nativeListener: { remove: () => void } | null = null
  private readyokResolve: (() => void) | null = null
  /** 原生引擎曾失败，后续直接走 WASM，避免每次初始化都挂起十几秒 */
  private nativeFailed = false
  /** 原生引擎的 NNUE 权重路径（插件 start 时解压后返回） */
  private nativeNetPath = ''
  /** 本地 WebSocket 桥接（Desktop 原生 Pikafish 多线程引擎） */
  private ws: WebSocket | null = null
  private useWebSocket = false
  private wsFailed = false

  constructor(options: EngineOptions = {}) {
    this.depth = options.depth ?? 16
  }

  async init(options: EngineOptions = {}): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInit(options)
    return this.initPromise
  }

  private async doInit(options: EngineOptions): Promise<void> {
    // wasmPath 形如 '/wasm/single'，取最后一段作为 wasm_type
    const wasmType = (options.wasmPath ?? '/wasm/single').split('/').filter(Boolean).pop() ?? 'single'

    // 优先尝试原生引擎（仅 Android 且插件已注册）；失败则回退 WASM，保证可用
    if (Capacitor.isNativePlatform() && !!getNativePlugin() && !this.nativeFailed) {
      try {
        await this.spawnNative()
        // sendCommand 依赖 useNative 选择路由（native plugin vs WASM worker），
        // 必须在握手前设为 true，否则 uci/setoption/isready 全部发往 null worker → 静默丢弃
        this.useNative = true
        // 先握手（uci→uciok）再设权重：setoption EvalFile 会同步加载 53MB NNUE，
        // 若放在 uci 之前，慢设备上 uciok 会被拖到超时
        this.sendCommand('uci')
        await this.waitForUciOk(30000)
        this.sendCommand(`setoption name Threads value ${nativeThreadCount()}`)
        this.sendCommand('setoption name Hash value 256')
        if (this.nativeNetPath) {
          this.sendCommand(`setoption name EvalFile value ${this.nativeNetPath}`)
        }
        // setoption EvalFile 会同步加载 NNUE（51MB ZSTD→63MB 解压 + 内存初始化），
        // 慢设备上可能需要 30~60 秒，isready 须等到 readyok 才能继续
        this.sendCommand('isready')
        await this.waitForReadyOk(60000)
        await this.sleep(200)

        this.isInitialized = true
        this.status = 'ready'
        console.log('[Pikafish] 引擎就绪 (Native)')
        return
      } catch (e) {
        console.error('[Pikafish] 原生引擎初始化失败，回退 WASM:', e)
        await this.teardownNative()
        this.nativeFailed = true
        const reason = e instanceof Error ? e.message : String(e)
        options.fallbackNotice?.('原生引擎不可用，已回退内置(WASM)引擎：' + reason)
        // 继续走下方 WASM 回退
      }
    }

    // WebSocket 桥接（Desktop 原生 Pikafish 多线程引擎）
    if (!Capacitor.isNativePlatform() && !this.wsFailed) {
      try {
        await this.spawnWebSocket()
        this.useWebSocket = true
        this.sendCommand('uci')
        await this.waitForUciOk(5000)
        const cores = (navigator as any).hardwareConcurrency || 4
        this.sendCommand(`setoption name Threads value ${Math.max(1, Math.min(cores, 8))}`)
        this.sendCommand('setoption name Hash value 256')
        this.sendCommand('isready')
        await this.waitForReadyOk(5000)
        await this.sleep(200)
        this.isInitialized = true
        this.status = 'ready'
        console.log('[Pikafish] 引擎就绪 (Native/WebSocket)')
        return
      } catch (e) {
        console.log('[Pikafish] WebSocket 桥接不可用，回退 WASM:', (e as Error).message)
        this.wsFailed = true
        this.ws?.close()
        this.ws = null
        // 继续走 WASM 回退
      }
    }

    // WASM（Web 或原生回退）
    this.useNative = false
    try {
      await this.spawnWorker(wasmType)
      this.sendCommand('uci')
      await this.waitForUciOk(8000)
      this.sendCommand(`setoption name Threads value ${options.threads ?? 1}`)
      this.sendCommand(`setoption name Hash value ${options.hash ?? 128}`)
      await this.sleep(200)
      this.isInitialized = true
      this.status = 'ready'
      console.log('[Pikafish] 引擎就绪 (Worker/WASM)')
    } catch (e) {
      console.error('[Pikafish] 初始化失败:', e)
      this.worker?.terminate()
      this.worker = null
      this.initPromise = null // 允许重试
      throw e
    }
  }

  /** 启动引擎 Worker 并等待就绪 */
  private spawnWorker(wasmType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let worker: Worker
      try {
        worker = new Worker(WORKER_URL)
      } catch (e) {
        reject(new Error(`无法创建 Worker: ${WORKER_URL}`))
        return
      }
      this.worker = worker

      const timer = setTimeout(() => reject(new Error('加载 Pikafish 超时')), 60000)

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg?.error) {
          clearTimeout(timer)
          reject(new Error(String(msg.error)))
          return
        }
        if (msg?.log) {
          console.log('[PikaW]', msg.log)
        } else if (msg?.ready) {
          clearTimeout(timer)
          resolve()
        } else if (msg?.stdout) {
          this.handleOutput(msg.stdout)
        }
        // msg.download 为下载进度，暂不使用
      }
      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timer)
        reject(new Error(e.message ? `Worker 出错: ${e.message}` : 'Worker 运行出错'))
      }

      worker.postMessage({
        wasm_type: wasmType,
        origin: window.location.origin,
        debug: import.meta.env.DEV, // 仅开发模式输出诊断日志
      })
    })
  }

  /** 启动原生 Android 引擎（独立进程），等待其 stdout 监听就绪 */
  private spawnNative(): Promise<void> {
    return new Promise((resolve, reject) => {
      const plugin = getNativePlugin()
      if (!plugin) {
        reject(new Error('NativePikafish 插件不可用'))
        return
      }
      const timer = setTimeout(() => reject(new Error('启动原生引擎超时')), 30000)
      plugin.start({}).then(async (data: any) => {
        try {
          this.nativeNetPath = (data as any)?.netPath ?? ''
          // 必须在发送任何 UCI 命令前完成监听注册，避免漏掉首行 uciok
          this.nativeListener = await plugin.addListener('stdout', (e: { line: string }) => this.handleOutput(e.line))
          clearTimeout(timer)
          resolve()
        } catch (err) {
          clearTimeout(timer)
          reject(new Error(String((err as any)?.message ?? err)))
        }
      }).catch((err: any) => {
        clearTimeout(timer)
        reject(new Error(String(err?.message ?? err)))
      })
    })
  }

  /** 清理原生引擎进程与监听（用于回退或退出） */
  private async teardownNative() {
    try { this.nativeListener?.remove() } catch { /* noop */ }
    this.nativeListener = null
    try { await getNativePlugin()?.quit() } catch { /* noop */ }
  }

  /** 尝试连接本地 WebSocket 桥接服务器（node server/pikafish-server.mjs） */
  private spawnWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = 3001
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('WebSocket 连接超时')) }
      }, 3000)

      try {
        const ws = new WebSocket(`ws://localhost:${port}`)
        this.ws = ws

        ws.onopen = () => {
          if (!settled) { settled = true; clearTimeout(timer); resolve() }
        }
        ws.onmessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(String(e.data))
            if (msg?.line) this.handleOutput(msg.line)
          } catch { /* noop */ }
        }
        ws.onerror = () => {
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error('WebSocket 连接失败')) }
        }
        ws.onclose = () => {
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error('WebSocket 已关闭')) }
          this.ws = null
        }
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); reject(e) }
      }
    })
  }

  /** 等待引擎返回 uciok */
  private waitForUciOk(timeoutMs: number): Promise<void> {    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('UCI 握手超时')), timeoutMs)
      this.uciOkResolve = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  /** 等待引擎返回 readyok（原生引擎预热 NNUE 权重后） */
  private waitForReadyOk(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('引擎预热超时')), timeoutMs)
      this.readyokResolve = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  setOption(name: string, value: string | number) {
    this.sendCommand(`setoption name ${name} value ${value}`)
  }

  setDepth(depth: number) { this.depth = depth }

  sendCommand(cmd: string) {
    if (this.useWebSocket && this.ws) {
      this.ws.send(JSON.stringify({ command: cmd }))
      return
    }
    if (this.useNative) {
      getNativePlugin()?.send({ command: cmd })
      return
    }
    this.worker?.postMessage({ command: cmd })
  }

  setPosition(fen: string, moves: string[] = []) {
    this.sendCommand(moves.length > 0
      ? `position fen ${fen} moves ${moves.join(' ')}`
      : `position fen ${fen}`)
  }

  async go(fen: string, moves: string[] = [], depth?: number, ms?: number, onInfo?: (info: EngineInfo) => void): Promise<string> {
    if (!this.isInitialized) throw new Error('引擎未初始化')
    const d = depth ?? this.depth
    this.status = 'thinking'
    this.onInfoCallback = onInfo ?? null
    return new Promise<string>((resolve) => {
      this.onBestMoveCallback = (move) => { this.status = 'idle'; resolve(move) }
      this.setPosition(fen, moves)
      // 优先用时间预算（保证尽快返回，避免长时间搜索卡死 UI）；否则按深度
      this.sendCommand(ms ? `go movetime ${ms}` : `go depth ${d}`)
    })
  }

  analyze(fen: string, moves: string[] = [], depth?: number, onInfo?: (info: EngineInfo) => void, ms?: number): Promise<string> {
    if (!this.isInitialized) throw new Error('引擎未初始化')
    const d = depth ?? this.depth
    this.status = 'thinking'
    this.onInfoCallback = onInfo ?? null
    return new Promise<string>((resolve) => {
      this.onBestMoveCallback = (move) => { this.status = 'idle'; resolve(move) }
      this.setPosition(fen, moves)
      // 优先用时间预算（保证尽快返回，避免长时间搜索卡死 UI）；否则按深度
      this.sendCommand(ms ? `go movetime ${ms}` : `go depth ${d}`)
    })
  }

  /**
   * 多 PV 分析：返回前 N 个候选着法及其评估
   * 用于摆棋/局面分析（计划第16节）
   */
  analyzeLines(
    fen: string,
    moves: string[],
    depth: number,
    multiPV: number,
    onUpdate?: (lines: EngineInfo[]) => void,
    timeMs?: number,
  ): Promise<EngineInfo[]> {
    if (!this.isInitialized) throw new Error('引擎未初始化')
    const sortLines = (m: Map<number, EngineInfo>) =>
      [...m.values()].sort((a, b) => (a.multipv ?? 1) - (b.multipv ?? 1))

    this.status = 'thinking'
    this.sendCommand(`setoption name MultiPV value ${multiPV}`)

    const lines = new Map<number, EngineInfo>()
    this.onInfoCallback = (info) => {
      // 引擎可能在最佳着法后补发无 pv 的 info，保留上一条的有效 pv
      const key = info.multipv ?? 1
      const prev = lines.get(key)
      const merged = (prev && (!info.pv || info.pv.length === 0)) ? { ...info, pv: prev.pv } : info
      lines.set(key, merged)
      onUpdate?.(sortLines(lines))
    }
    return new Promise<EngineInfo[]>((resolve) => {
      this.onBestMoveCallback = () => {
        this.status = 'idle'
        // 恢复单 PV，避免影响对局/复盘分析
        this.sendCommand('setoption name MultiPV value 1')
        resolve(sortLines(lines))
      }
      this.setPosition(fen, moves)
      // 优先用时间预算（保证尽快返回，避免长时间搜索卡死 UI）；否则按深度
      this.sendCommand(timeMs ? `go movetime ${timeMs}` : `go depth ${depth}`)
    })
  }

  stop() { this.sendCommand('stop'); this.status = 'idle' }
  quit() {
    if (this.useWebSocket) {
      this.ws?.close()
      this.ws = null
      this.useWebSocket = false
      this.isInitialized = false
      this.status = 'idle'
      return
    }
    if (this.useNative) {
      getNativePlugin()?.quit()
      this.nativeListener?.remove()
      this.nativeListener = null
      this.useNative = false
      this.isInitialized = false
      this.status = 'idle'
      return
    }
    this.worker?.terminate()
    this.worker = null
    this.isInitialized = false
    this.status = 'idle'
  }
  getStatus(): EngineStatus { return this.status }
  get isReady(): boolean { return this.isInitialized }

  private handleOutput(text: string) {
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (t === 'uciok' && this.uciOkResolve) {
        this.uciOkResolve()
        continue
      }
      if (t === 'readyok' && this.readyokResolve) {
        this.readyokResolve()
        continue
      }
      this.handleLine(t)
    }
  }

  private handleLine(line: string) {
    if (line.startsWith('bestmove')) {
      const move = line.split(' ')[1]
      if (move && this.onBestMoveCallback) this.onBestMoveCallback(move)
    } else if (line.startsWith('info')) {
      const info = this.parseInfo(line)
      if (info && this.onInfoCallback) this.onInfoCallback(info)
    }
  }

  private parseInfo(text: string): EngineInfo | null {
    const parts = text.split(' ')
    let depth = 0, score = 0, multipv = 1, nodes = 0, nps = 0
    const pv: string[] = []
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'depth' && i + 1 < parts.length) depth = parseInt(parts[i + 1]) || 0
      else if (parts[i] === 'multipv' && i + 1 < parts.length) multipv = parseInt(parts[i + 1]) || 1
      else if (parts[i] === 'nodes' && i + 1 < parts.length) nodes = parseInt(parts[i + 1]) || 0
      else if (parts[i] === 'nps' && i + 1 < parts.length) nps = parseInt(parts[i + 1]) || 0
      else if (parts[i] === 'score' && i + 2 < parts.length) {
        const val = parseInt(parts[i + 2]) || 0
        score = parts[i + 1] === 'mate' ? (val > 0 ? 100000 - val : -100000 + val) : val
      } else if (parts[i] === 'pv' && i + 1 < parts.length) {
        for (let j = i + 1; j < parts.length; j++) pv.push(parts[j])
        break
      }
    }
    return depth === 0 ? null : { depth, score, move: pv[0] ?? '', pv, multipv, nodes, nps }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
