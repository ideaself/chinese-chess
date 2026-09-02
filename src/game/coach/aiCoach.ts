/**
 * AI 教练服务（DeepSeek 等 OpenAI 兼容接口）
 *
 * - 配置存于应用设置（localStorage）
 * - 默认走开发代理 /ai-proxy（vite.config.ts 中转发到 api.deepseek.com），
 *   生产/移动端可在设置里改为直连地址或自建网关
 */

import { getSettings } from '../storage'
import { loadSimilarShard, querySimilar, moveScore } from '../similar'
import { chineseFromFen } from '../rules'

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
  /** 已走着法 UCI 序列（供大师参考检索） */
  moves?: string[]
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

/** 调用 AI 教练；hooks.onDelta 流式输出回答，hooks.onReasoning 流式输出思考过程
 *  （deepseek-reasoner 先思考后作答）。失败抛出异常。
 *  思考型模型若把输出额度全部耗在思考上（空回答 + finish_reason=length），
 *  自动去掉 max_tokens 限制重试一次。
 *  history 为多轮对话上下文（不含本轮提问），自动截取最近 6 条。 */
export async function askCoach(
  ctx: CoachContext,
  question: string,
  hooks: {
    onDelta?: (fullText: string) => void
    onReasoning?: (fullReasoning: string) => void
  } = {},
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<string> {
  const cfg = getCoachConfig()
  if (!cfg.apiKey) throw new Error('未配置 AI 教练 API Key')

  const isReasoner = cfg.model.includes('reasoner')
  // deepseek-reasoner 不接受 system 消息：把人设并入首条用户消息
  const facts = await buildFacts(ctx)
  const userContent = isReasoner
    ? `${SYSTEM_PROMPT}\n\n${facts}\n\n学生的问题: ${question}`
    : `${facts}\n\n学生的问题: ${question}`
  const messages: Array<{ role: string; content: string }> = [
    ...(!isReasoner ? [{ role: 'system', content: SYSTEM_PROMPT }] : []),
    ...history.slice(-6),
    { role: 'user', content: userContent },
  ]

  const emitDelta = hooks.onDelta

  /** 单次请求；omitLimit 时不下发 max_tokens（交由服务端默认） */
  const requestOnce = async (omitLimit: boolean): Promise<{
    full: string
    reasoning: string
    finish: string
  }> => {
    const bodyObj: Record<string, unknown> = {
      model: cfg.model,
      messages,
      temperature: isReasoner ? undefined : 0.7,
      stream: typeof emitDelta === 'function',
    }
    if (!omitLimit && !isReasoner) bodyObj.max_tokens = 2048

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(bodyObj),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`AI 教练请求失败 (HTTP ${res.status}) ${text.slice(0, 120)}`)
    }

    // 非流式：整体 JSON
    if (!emitDelta || !res.body) {
      const data = await res.json()
      const choice = data?.choices?.[0]
      const msg = choice?.message ?? {}
      let full = ''
      if (typeof msg.content === 'string' && msg.content.trim()) {
        full = msg.content
        emitDelta?.(full.trim())
      }
      return {
        full,
        reasoning: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '',
        finish: choice?.finish_reason ?? '',
      }
    }

    // 流式 SSE
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    let reasoning = ''
    let finish = ''

    const handleLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const choice = JSON.parse(payload)?.choices?.[0]
        if (!choice) return
        if (choice.finish_reason) finish = choice.finish_reason
        const delta = choice.delta ?? {}
        if (typeof delta.content === 'string' && delta.content) {
          full += delta.content
          emitDelta?.(full)
        } else if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          reasoning += delta.reasoning_content
          hooks.onReasoning?.(reasoning)
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
    return { full, reasoning, finish }
  }

  // 首次请求；空回答且疑似思考吞掉额度（finish=length 或仅有思考内容）→ 放开限制重试一次
  let r = await requestOnce(false)
  if (!r.full.trim() && (r.finish === 'length' || !!r.reasoning.trim())) {
    r = await requestOnce(true)
  }
  if (!r.full.trim()) throw new Error(emptyHint(r))
  return r.full.trim()

  function emptyHint(x: { reasoning: string; finish: string }): string {
    if (x.reasoning.trim()) {
      return 'AI 教练没有给出最终回答：该模型的思考占用了全部输出额度（已自动重试仍如此）。建议更换为非思考型模型'
    }
    if (x.finish === 'length') return 'AI 教练返回内容为空（输出达到上限）'
    return 'AI 教练返回内容为空'
  }
}

async function buildFacts(ctx: CoachContext): Promise<string> {
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

  // 大师参考（RAG）：当前局面大师实战着法分布
  if (ctx.moves && ctx.moves.length > 0 && ctx.moves.length <= 6) {
    try {
      const ok = await loadSimilarShard(ctx.moves[0])
      if (ok) {
        const entries = querySimilar(ctx.moves)
        if (entries && entries.length > 0) {
          const top = entries.slice(0, 3).map(e => {
            const { n, redScore } = moveScore(e)
            const cn = e.move.length >= 4 ? chineseFromFen(ctx.fen, e.move) : e.move
            return `${cn}（${n} 局，红方得分率 ${Math.round(redScore * 100)}%）`
          })
          facts.push(`大师实战参考（141k 局棋谱统计）: ${top.join('；')}`)
        }
      }
    } catch { /* 参考数据失败不影响教练回答 */ }
  }
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
