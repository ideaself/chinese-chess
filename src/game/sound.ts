/**
 * 音效系统
 *
 * 使用 Web Audio API 合成棋子音效:
 *   - 落子: 短促清脆的木质敲击声
 *   - 吃子: 更重的撞击声
 *   - 将军: 紧急提示音
 */

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
}

/** 真实音效资源（CC0，freesound.org）：落子 / 吃子 */
const SFX_MOVE_URL = '/sounds/move.mp3'
const SFX_CAPTURE_URL = '/sounds/capture.mp3'
/** 人声音效（神经网络中文语音生成，离线播放）：吃 / 将军 */
const SFX_VOICE_CHI_URL = '/sounds/voice_chi.mp3'
const SFX_VOICE_JIANGJUN_URL = '/sounds/voice_jiangjun.mp3'

/** 播放音频文件；加载/播放失败则回退到合成音 */
function playSfxFile(url: string, volume: number, fallback?: () => void) {
  try {
    const a = new Audio(url)
    a.volume = volume
    const p = a.play()
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch(() => fallback?.())
    }
  } catch {
    fallback?.()
  }
}

/** 生成木质敲击音 */
function playTap(volume: number = 0.5, freq: number = 800) {
  const ctx = getAudioCtx()
  const now = ctx.currentTime

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, now)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.3, now + 0.08)

  gain.gain.setValueAtTime(volume, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

  osc.connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.15)
}

/** 生成撞击音 */
function playImpact(volume: number = 0.6) {
  const ctx = getAudioCtx()
  const now = ctx.currentTime

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(200, now)
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.15)

  gain.gain.setValueAtTime(volume, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)

  osc.connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.25)
}

/** 生成紧急提示音 */
function playAlert(volume: number = 0.5) {
  const ctx = getAudioCtx()
  const now = ctx.currentTime

  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t = now + i * 0.15

    osc.type = 'square'
    osc.frequency.setValueAtTime(1200, t)
    osc.frequency.setValueAtTime(800, t + 0.06)

    gain.gain.setValueAtTime(volume * 0.4, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12)

    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.15)
  }
}

// ── 公开 API ──────────────────────────────────────────────────────

export function playMoveSound(enabled: boolean = true) {
  if (!enabled) return
  playSfxFile(SFX_MOVE_URL, 0.7, () => { try { playTap(0.45, 800 + Math.random() * 200) } catch {} })
}

export function playCaptureSound(enabled: boolean = true) {
  if (!enabled) return
  playSfxFile(SFX_CAPTURE_URL, 0.85, () => { try { playImpact(0.55) } catch {} })
}

export function playCheckSound(enabled: boolean = true) {
  if (!enabled) return
  try { playAlert(0.5) } catch {}
}

/** 吃子语音「吃」：优先播放真人录音，缺失时回退浏览器 TTS */
export function playCaptureVoice(enabled: boolean = true) {
  if (!enabled) return
  playSfxFile(SFX_VOICE_CHI_URL, 1, () => speakFallback('吃'))
}

/** 将军语音「将军」：优先播放真人录音，缺失时回退浏览器 TTS */
export function playCheckVoice(enabled: boolean = true) {
  if (!enabled) return
  playSfxFile(SFX_VOICE_JIANGJUN_URL, 1, () => speakFallback('将军'))
}

/** 浏览器语音合成兜底（部分环境无真人音频资源时） */
function speakFallback(text: string) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    if (synth.speaking) synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1.2
    u.pitch = 1.1
    u.volume = 1
    synth.speak(u)
  } catch {}
}

/** 恢复被浏览器暂停的 AudioContext */
export function resumeAudio() {
  try {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {}
}

// ── 触感反馈（移动端） ────────────────────────────────────────────

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  } catch {}
}

/** 落子轻震 */
export function playMoveHaptic(enabled: boolean = true) {
  if (enabled) vibrate(12)
}

/** 将军警示震 */
export function playCheckHaptic(enabled: boolean = true) {
  if (enabled) vibrate([30, 40, 30])
}

/** 对局结束震 */
export function playGameOverHaptic(enabled: boolean = true) {
  if (enabled) vibrate([50, 60, 50, 60, 80])
}
