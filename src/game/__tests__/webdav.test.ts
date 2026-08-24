/**
 * WebDAV 云同步测试：请求构造 / 目录创建 / 错误处理 / 凭据校验
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// storage 依赖 localStorage → mock 最小实现
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
})
vi.stubGlobal('btoa', (s: string) => Buffer.from(s).toString('base64'))

import { uploadBackup, downloadBackup, backupUrl, credFromSettings, BACKUP_FILENAME } from '../webdav'
import { saveSettings } from '../storage'

const CRED = { url: 'https://dav.example.com/dav/xiangqi', user: 'u', password: 'p' }

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
})

describe('URL 构造', () => {
  it('备份地址 = 目录 + 固定文件名', () => {
    expect(backupUrl(CRED)).toBe('https://dav.example.com/dav/xiangqi/' + BACKUP_FILENAME)
  })

  it('credFromSettings 未配置返回 null', () => {
    expect(credFromSettings()).toBeNull()
    saveSettings({ webdavUrl: 'https://x', webdavUser: 'a' })
    expect(credFromSettings()).toBeNull() // 缺密码
    saveSettings({ webdavPassword: 'b' })
    expect(credFromSettings()).toEqual({ url: 'https://x', user: 'a', password: 'b' })
  })
})

describe('uploadBackup', () => {
  it('先对整路径 MKCOL（409 才逐级）再 PUT，带 Basic 认证', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, text: async () => '' })
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(true)
    // 整路径一次 MKCOL + 一次 PUT
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url1, init1] = fetchMock.mock.calls[0]
    expect(url1).toBe('/__webdav/dav/xiangqi')
    expect(init1.headers['x-wd-target']).toBe('https://dav.example.com')
    expect(init1.method).toBe('MKCOL')
    expect(init1.headers.Authorization).toMatch(/^Basic /)
    const [putUrl, putInit] = fetchMock.mock.calls[1]
    expect(putUrl).toBe('/__webdav/dav/xiangqi/' + BACKUP_FILENAME)
    expect(putInit.method).toBe('PUT')
    expect(JSON.parse(putInit.body).version).toBe(2) // 全量备份格式
  })

  it('MKCOL 405（已存在）不视为失败', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith(BACKUP_FILENAME)
        ? { ok: true, status: 204, text: async () => '' }
        : { ok: false, status: 405, text: async () => '' })
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(true)
  })

  it('MKCOL 409（父级缺失）回退逐级创建', async () => {
    const seen = new Map<string, number>()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const m = (init as { method?: string })?.method
      if (m === 'PUT') return { ok: true, status: 201, text: async () => '' }
      if (m === 'MKCOL') {
        // 完整路径首次 409（父级缺失），重试成功；浅层视为已存在(405)
        if (url === '/__webdav/dav/xiangqi') {
          const n = (seen.get(url) ?? 0) + 1
          seen.set(url, n)
          return n === 1
            ? { ok: false, status: 409, text: async () => '' }
            : { ok: true, status: 201, text: async () => '' }
        }
        return { ok: false, status: 405, text: async () => '' }
      }
      return { ok: true, status: 201, text: async () => '' }
    })
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(true)
    const mkcols = fetchMock.mock.calls.filter(c => (c[1] as { method?: string })?.method === 'MKCOL').map(c => c[0])
    expect(mkcols).toEqual(['/__webdav/dav/xiangqi', '/__webdav/dav', '/__webdav/dav/xiangqi'])
  })

  it('MKCOL 404 带出完整 URL 便于排查地址', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init as { method?: string })?.method === 'MKCOL'
        ? { ok: false, status: 404, text: async () => '' }
        : { ok: true, status: 201, text: async () => '' })
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('https://dav.example.com/dav/xiangqi')
    expect(r.message).toContain('404')
  })

  it('PUT 失败返回错误消息', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith(BACKUP_FILENAME)
        ? { ok: false, status: 507, text: async () => '' }
        : { ok: false, status: 405, text: async () => '' })
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('507')
  })

  it('网络异常（CORS 等）给出可读提示', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('CORS')
  })
})

describe('downloadBackup', () => {
  it('404 提示云端暂无备份', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => '' })
    const r = await downloadBackup(CRED)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('暂无')
  })

  it('成功拉取并走合并恢复', async () => {
    const payload = JSON.stringify({ version: 2, games: [], settings: { theme: 'light' }, quizStats: { asked: 5, right: 3, bestStreak: 2 } })
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => payload })
    const r = await downloadBackup(CRED)
    expect(r.ok).toBe(true)
    expect(r.message).toContain('设置已合并')
  })
})
