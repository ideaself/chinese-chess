/**
 * WebDAV 云同步通道（坚果云 / 自建服务器等 OpenDAV 兼容服务）
 *
 * 仅做两件事：上传全量备份 / 下载远端备份。
 * - 备份文件固定为 <目录>/xiangqi-backup.json
 * - 上传前先 MKCOL 确保目录存在（405 = 已存在，忽略）
 * - Basic 认证；凭据存于应用设置（localStorage）
 */

import { exportFullBackup, importFullBackup, getSettings, saveSettings } from './storage'

export const BACKUP_FILENAME = 'xiangqi-backup.json'

export interface WebdavCred {
  url: string
  user: string
  password: string
}

/** 从应用设置读取凭据；未配置返回 null */
export function credFromSettings(): WebdavCred | null {
  const s = getSettings()
  if (!s.webdavUrl || !s.webdavUser || !s.webdavPassword) return null
  return { url: s.webdavUrl.replace(/\/+$/, ''), user: s.webdavUser, password: s.webdavPassword }
}

function authHeader(cred: WebdavCred): string {
  return 'Basic ' + btoa(`${cred.user}:${cred.password}`)
}

export function backupUrl(cred: WebdavCred): string {
  return `${cred.url}/${BACKUP_FILENAME}`
}

async function ensureCollection(url: string, cred: WebdavCred): Promise<void> {
  // 逐级建目录（a/b → MKCOL a、MKCOL a/b），已存在(405)视为成功
  const parts = url.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean)
  let prefix = url.match(/^https?:\/\/[^/]+/)?.[0] ?? ''
  for (const seg of parts) {
    prefix += '/' + seg
    try {
      const r = await fetch(prefix, {
        method: 'MKCOL',
        headers: { Authorization: authHeader(cred) },
      })
      if (!r.ok && r.status !== 405) {
        throw new Error(`创建目录失败 (HTTP ${r.status})`)
      }
    } catch (e) {
      if (e instanceof TypeError) throw new Error('网络错误或 CORS 拦截')
      throw e
    }
  }
}

export interface SyncResult {
  ok: boolean
  message: string
}

/** 上传全量备份到云端 */
export async function uploadBackup(cred: WebdavCred): Promise<SyncResult> {
  try {
    await ensureCollection(cred.url, cred)
    const json = exportFullBackup()
    const r = await fetch(backupUrl(cred), {
      method: 'PUT',
      headers: {
        Authorization: authHeader(cred),
        'Content-Type': 'application/json',
      },
      body: json,
    })
    if (!r.ok && r.status !== 201 && r.status !== 204) {
      return { ok: false, message: `上传失败 (HTTP ${r.status})` }
    }
    markLastSync()
    return { ok: true, message: `已备份到云端（${(json.length / 1024).toFixed(0)} KB）` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** 从云端拉取备份并合并恢复 */
export async function downloadBackup(cred: WebdavCred): Promise<SyncResult> {
  try {
    const r = await fetch(backupUrl(cred), {
      method: 'GET',
      headers: { Authorization: authHeader(cred) },
    })
    if (r.status === 404) return { ok: false, message: '云端暂无备份' }
    if (!r.ok) return { ok: false, message: `下载失败 (HTTP ${r.status})` }
    const json = await r.text()
    const s = importFullBackup(json)
    const parts = [
      s.games > 0 ? `新增 ${s.games} 局` : null,
      s.settingsMerged ? '设置已合并' : null,
      s.mistakes > 0 ? `错题 +${s.mistakes}` : null,
      s.ratingRestored ? '棋力分已恢复' : null,
    ].filter(Boolean)
    markLastSync()
    return { ok: true, message: parts.length ? `云备份恢复：${parts.join(' · ')}` : '云端与本机一致，无需恢复' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

// ── 最近同步时间（localStorage） ──────────────────────────────────

const LAST_SYNC_KEY = 'xiangqi_last_cloud_sync'

function markLastSync(): void {
  try { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())) } catch { /* ignore */ }
}

export function getLastSync(): number | null {
  try {
    const v = localStorage.getItem(LAST_SYNC_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

/** 保存凭据到设置（明文存 localStorage，与 AI 教练 Key 同级） */
export function saveCredToSettings(cred: WebdavCred): void {
  saveSettings({ webdavUrl: cred.url, webdavUser: cred.user, webdavPassword: cred.password })
}
