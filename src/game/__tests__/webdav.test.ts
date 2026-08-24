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
  it('先逐级 MKCOL 再 PUT，带 Basic 认证', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 })
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(true)
    // /dav 与 /dav/xiangqi 两次 MKCOL + 一次 PUT
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [url1, init1] = fetchMock.mock.calls[0]
    expect(url1).toBe('https://dav.example.com/dav')
    expect(init1.method).toBe('MKCOL')
    expect(init1.headers.Authorization).toMatch(/^Basic /)
    const [putUrl, putInit] = fetchMock.mock.calls[2]
    expect(putUrl).toContain(BACKUP_FILENAME)
    expect(putInit.method).toBe('PUT')
    expect(JSON.parse(putInit.body).version).toBe(2) // 全量备份格式
  })

  it('MKCOL 405（已存在）不视为失败', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith(BACKUP_FILENAME)
        ? { ok: true, status: 204 }
        : { ok: false, status: 405 })
    const r = await uploadBackup(CRED)
    expect(r.ok).toBe(true)
  })

  it('PUT 失败返回错误消息', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith(BACKUP_FILENAME)
        ? { ok: false, status: 507 }
        : { ok: true, status: 201 })
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
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
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
