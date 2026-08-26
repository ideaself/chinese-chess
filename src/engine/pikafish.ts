/**
 * Pikafish WASM 引擎封装（Worker 版）
 *
 * 引擎运行在专用 Web Worker 中（public/wasm/EngineHelperWorker.js），
 * 主线程通过 postMessage 收发 UCI 命令，深度分析不再阻塞 UI。
 */

export interface EngineOptions {
  depth?: number
  threads?: number
  hash?: number
  wasmPath?: string
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

    try {
      await this.spawnWorker(wasmType)

      // UCI 握手（等待 uciok，而非盲等）
      this.sendCommand('uci')
      await this.waitForUciOk(8000)
      this.sendCommand(`setoption name Threads value ${options.threads ?? 1}`)
      this.sendCommand(`setoption name Hash value ${options.hash ?? 128}`)
      await this.sleep(200)

      this.isInitialized = true
      this.status = 'ready'
      console.log('[Pikafish] 引擎就绪 (Worker)')
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

  /** 等待引擎返回 uciok */
  private waitForUciOk(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('UCI 握手超时')), timeoutMs)
      this.uciOkResolve = () => {
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
    this.worker?.postMessage({ command: cmd })
  }

  setPosition(fen: string, moves: string[] = []) {
    this.sendCommand(moves.length > 0
      ? `position fen ${fen} moves ${moves.join(' ')}`
      : `position fen ${fen}`)
  }

  async go(fen: string, moves: string[] = [], depth?: number, ms?: number): Promise<string> {
    if (!this.isInitialized) throw new Error('引擎未初始化')
    const d = depth ?? this.depth
    this.status = 'thinking'
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
