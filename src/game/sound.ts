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
  try { playTap(0.45, 800 + Math.random() * 200) } catch {}
}

export function playCaptureSound(enabled: boolean = true) {
  if (!enabled) return
  try { playImpact(0.55) } catch {}
}

export function playCheckSound(enabled: boolean = true) {
  if (!enabled) return
  try { playAlert(0.5) } catch {}
}

/** 恢复被浏览器暂停的 AudioContext */
export function resumeAudio() {
  try {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {}
}
