/**
 * WebDAV 云同步通道（坚果云 / 自建服务器等 OpenDAV 兼容服务）
 *
 * 仅做两件事：上传全量备份 / 下载远端备份。
 * - 备份文件固定为 <目录>/xiangqi-backup.json
 * - 上传前逐级 MKCOL 确保目录存在（405 = 已存在，忽略）
 * - Basic 认证；凭据存于应用设置（localStorage）
 *
 * 跨域策略（WebDAV 服务普遍不返回 CORS 头）：
 *   - Android/iOS App: 走 CapacitorHttp 原生请求，不受 CORS 限制
 *   - 本地开发: 经 vite 中间件 /__webdav 反代（目标由 x-wd-target 头传递）
 *   - 生产网页: 直连（仅当服务端允许跨域时可用），失败给出可读提示
 */

import { CapacitorHttp, Capacitor } from '@capacitor/core'
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

export function backupOrigin(cred: WebdavCred): string {
  return new URL(cred.url).origin
}

/** 目录路径（如 /dav/xiangqi） */
function collectionPath(cred: WebdavCred): string {
  return new URL(cred.url).pathname.replace(/\/+$/, '')
}

export function backupUrl(cred: WebdavCred): string {
  return backupOrigin(cred) + collectionPath(cred) + '/' + BACKUP_FILENAME
}

interface WdResponse {
  status: number
  ok: boolean
  text: string
}

const FETCH_FAILED = 'FETCH_FAILED'

/**
 * 统一底层请求：按运行环境选择原生/代理/直连。
 * 网络层失败抛 TypeError(FETCH_FAILED)，HTTP 层失败返回非 2xx 响应。
 */
async function wdRaw(
  cred: WebdavCred,
  method: 'GET' | 'PUT' | 'MKCOL',
  absUrl: string,
  body?: string,
): Promise<WdResponse> {
  const headers: Record<string, string> = { Authorization: authHeader(cred) }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  // ── 原生 App：CapacitorHttp 直连 ──
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.request({
        method,
        url: absUrl,
        headers,
        data: body,
        readAs: 'text',
      } as Parameters<typeof CapacitorHttp.request>[0])
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
      return { status: res.status, ok: res.status >= 200 && res.status < 300, text }
    } catch (e) {
      throw new TypeError(`${FETCH_FAILED}:${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ── 浏览器：开发代理 / 生产直连 ──
  let target = absUrl
  if (import.meta.env.DEV) {
    const u = new URL(absUrl)
    target = '/__webdav' + u.pathname + (u.search || '')
    headers['x-wd-target'] = u.origin
  }
  try {
    const r = await fetch(target, { method, headers, body })
    return { status: r.status, ok: r.ok, text: await r.text().catch(() => '') }
  } catch {
    throw new TypeError(FETCH_FAILED)
  }
}

/** 把底层网络错误翻译成可读提示 */
function readable(e: unknown): SyncResult {
  if (e instanceof TypeError && e.message.startsWith(FETCH_FAILED)) {
    const detail = e.message.slice(FETCH_FAILED.length + 1)
    if (detail) return { ok: false, message: `请求失败：${detail}` }
    return {
      ok: false,
      message: '网络错误：浏览器直连被 CORS 拦截。请改用手机 App 端（原生直连）或本地开发模式',
    }
  }
  return { ok: false, message: e instanceof Error ? e.message : String(e) }
}

/** 逐级创建目录；405（已存在）视为成功 */
async function ensureCollection(cred: WebdavCred): Promise<void> {
  const segments = collectionPath(cred).split('/').filter(Boolean)
  let pathAcc = ''
  for (const seg of segments) {
    pathAcc += '/' + seg
    try {
      const r = await wdRaw(cred, 'MKCOL', backupOrigin(cred) + pathAcc)
      if (!r.ok && r.status !== 405) {
        throw new Error(`创建目录失败 (HTTP ${r.status})`)
      }
    } catch (e) {
      if (e instanceof TypeError && e.message.startsWith(FETCH_FAILED)) throw e
      if (e instanceof TypeError) throw new TypeError(FETCH_FAILED)
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
    await ensureCollection(cred)
    const json = exportFullBackup()
    const r = await wdRaw(cred, 'PUT', backupUrl(cred), json)
    if (!r.ok && r.status !== 201 && r.status !== 204) {
      return { ok: false, message: `上传失败 (HTTP ${r.status})${r.status === 401 ? '：账号或密码错误' : ''}` }
    }
    markLastSync()
    return { ok: true, message: `已备份到云端（${(json.length / 1024).toFixed(0)} KB）` }
  } catch (e) {
    return readable(e)
  }
}

/** 从云端拉取备份并合并恢复 */
export async function downloadBackup(cred: WebdavCred): Promise<SyncResult> {
  try {
    const r = await wdRaw(cred, 'GET', backupUrl(cred))
    if (r.status === 404) return { ok: false, message: '云端暂无备份' }
    if (!r.ok) {
      return { ok: false, message: `下载失败 (HTTP ${r.status})${r.status === 401 ? '：账号或密码错误' : ''}` }
    }
    const s = importFullBackup(r.text)
    const parts = [
      s.games > 0 ? `新增 ${s.games} 局` : null,
      s.settingsMerged ? '设置已合并' : null,
      s.mistakes > 0 ? `错题 +${s.mistakes}` : null,
      s.ratingRestored ? '棋力分已恢复' : null,
    ].filter(Boolean)
    markLastSync()
    return { ok: true, message: parts.length ? `云备份恢复：${parts.join(' · ')}` : '云端与本机一致，无需恢复' }
  } catch (e) {
    return readable(e)
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
