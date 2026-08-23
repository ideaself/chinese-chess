/**
 * AI 教练服务测试（mock fetch + localStorage）
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { askCoach } from '../coach/aiCoach'

const store: Record<string, string> = {}

beforeAll(() => {
  // node 环境下补一个最小 localStorage
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  })
})

describe('askCoach', () => {
  it('未配置 Key 时抛错', async () => {
    await expect(askCoach({ fen: 'x', movesCn: '' }, '问题'))
      .rejects.toThrow('未配置')
  })

  it('调用 OpenAI 兼容接口并返回回复', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '此着稳健，可考虑车九进一' } }] }),
      url: String(url),
      init,
      status: 200,
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock)

    store['xiangqi_settings'] = JSON.stringify({ aiCoachApiKey: 'sk-test', aiCoachModel: 'deepseek-chat' })

    const reply = await askCoach(
      {
        fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
        movesCn: '1. 炮二平五 马8进7',
        red: '甲', black: '乙',
        openingName: '中炮',
        score: 30,
        bestMoveCn: '马二进三',
      },
      '下一步该怎么走？',
    )

    expect(reply).toContain('车九进一')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/ai-proxy/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('deepseek-chat')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toContain('炮二平五')
    expect(body.messages[1].content).toContain('中炮')
    expect(body.messages[1].content).toContain('红方领先约 0.3 兵')
  })

  it('HTTP 错误抛出带状态码的异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"bad key"}',
    })))
    store['xiangqi_settings'] = JSON.stringify({ aiCoachApiKey: 'sk-bad' })

    await expect(askCoach({ fen: 'x', movesCn: '' }, '?'))
      .rejects.toThrow('401')
  })
})
