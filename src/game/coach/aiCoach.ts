/**
 * AI 教练服务（DeepSeek 等 OpenAI 兼容接口）
 *
 * - 配置存于应用设置（localStorage）
 * - 默认走开发代理 /ai-proxy（vite.config.ts 中转发到 api.deepseek.com），
 *   生产/移动端可在设置里改为直连地址或自建网关
 */

import { getSettings } from '../storage'

export interface CoachConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export function getCoachConfig(): CoachConfig {
  const s = getSettings()
  return {
    apiKey: s.aiCoachApiKey || '',
    baseUrl: (s.aiCoachBaseUrl || '/ai-proxy').replace(/\/+$/, ''),
    model: s.aiCoachModel || 'deepseek-chat',
  }
}

export function isCoachEnabled(): boolean {
  return getCoachConfig().apiKey.trim().length > 0
}

export interface CoachContext {
  /** 当前局面 FEN */
  fen: string
  /** 中文着法序列（如 "1. 炮二平五 马8进7 ..."） */
  movesCn: string
  /** 红黑双方 */
  red?: string
  black?: string
  /** 开局名称（已识别时传入） */
  openingName?: string
  /** 引擎评估（厘兵，红方视角） */
  score?: number
  /** 引擎最佳着法中文 */
  bestMoveCn?: string
}

const SYSTEM_PROMPT = `你是一位资深中国象棋高级教练，擅长指导业余爱好者提高棋力。
要求：
- 用中文回答，语气亲切专业，像教练面对面指导学生
- 结合局面具体分析：子力对比、阵型弱点、攻防要点、后续计划
- 给出具体着法建议时使用中文记谱（如"车九进一""马三进四"）
- 回答简洁有条理，控制在 300 字以内，先总评再给建议
- 若学生问的是刚走过的着法，点评其优劣并说明更好的选择`

/** 调用 AI 教练；传入 onDelta 时使用流式输出（SSE，逐段回调累计文本）；失败抛出异常 */
export async function askCoach(
  ctx: CoachContext,
  question: string,
  onDelta?: (fullText: string) => void,
): Promise<string> {
  const cfg = getCoachConfig()
  if (!cfg.apiKey) throw new Error('未配置 AI 教练 API Key')

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${buildFacts(ctx)}\n\n学生的问题: ${question}` },
  ]

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.7,
      max_tokens: 800,
      stream: typeof onDelta === 'function',
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI 教练请求失败 (HTTP ${res.status}) ${text.slice(0, 120)}`)
  }

  // 非流式路径
  if (!onDelta || !res.body) {
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI 教练返回内容为空')
    }
    onDelta?.(content.trim())
    return content.trim()
  }

  // 流式路径：解析 SSE data 行
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return
    try {
      const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        full += delta
        onDelta(full)
      }
    } catch { /* 忽略无法解析的心跳行 */ }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 1)
    }
  }
  if (buffer.trim()) handleLine(buffer)

  if (!full.trim()) throw new Error('AI 教练返回内容为空')
  return full.trim()
}

function buildFacts(ctx: CoachContext): string {
  const facts: string[] = []
  facts.push(`当前局面 FEN: ${ctx.fen}`)
  if (ctx.openingName) facts.push(`开局体系: ${ctx.openingName}`)
  if (ctx.red || ctx.black) facts.push(`对局双方: 红方 ${ctx.red || '?'} vs 黑方 ${ctx.black || '?'}`)
  if (typeof ctx.score === 'number') {
    const adv = ctx.score >= 0 ? `红方领先约 ${(ctx.score / 100).toFixed(1)} 兵` : `黑方领先约 ${(-ctx.score / 100).toFixed(1)} 兵`
    facts.push(`引擎评估: ${adv}`)
  }
  if (ctx.bestMoveCn) facts.push(`引擎推荐着法: ${ctx.bestMoveCn}`)
  if (ctx.movesCn) facts.push(`对局着法:\n${ctx.movesCn}`)
  return facts.join('\n')
}

// ── 模型列表自动获取（OpenAI 兼容 /models） ───────────────────────

let modelsCache: { key: string; models: string[] } | null = null

/**
 * 获取可用模型列表；按 baseUrl+Key 缓存，避免重复请求。
 * Key 未配置时抛错。
 */
export async function fetchModels(): Promise<string[]> {
  const cfg = getCoachConfig()
  if (!cfg.apiKey) throw new Error('未配置 API Key')

  const cacheKey = `${cfg.baseUrl}|${cfg.apiKey}`
  if (modelsCache && modelsCache.key === cacheKey) return modelsCache.models

  const res = await fetch(`${cfg.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`获取模型列表失败 (HTTP ${res.status})`)
  }

  const data = await res.json()
  const models: string[] = (data?.data ?? [])
    .map((m: { id?: unknown }) => m.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    .sort()

  if (models.length === 0) throw new Error('模型列表为空')

  modelsCache = { key: cacheKey, models }
  return models
}
