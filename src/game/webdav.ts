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
  method: string,
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
    if (/cleartext/i.test(detail)) {
      return {
        ok: false,
        message: '明文 HTTP 被 Android 拦截（cleartext not permitted）。请更新 APK（v1.13.8 起已放行），或改用 https 地址',
      }
    }
    if (detail) return { ok: false, message: `请求失败：${detail}` }
    return {
      ok: false,
      message: '网络错误：浏览器直连被 CORS 拦截。请改用手机 App 端（原生直连）或本地开发模式',
    }
  }
  return { ok: false, message: e instanceof Error ? e.message : String(e) }
}

/**
 * 确保目录存在：
 * 先对完整目录做一次 MKCOL（多数网盘父目录已存在，直接成功）；
 * 返回 409（父级缺失）时再从浅到深逐级补建；405 = 已存在忽略。
 * 其余状态抛错并携带 URL，便于排查地址填写问题。
 */
async function ensureCollection(cred: WebdavCred): Promise<void> {
  const full = collectionPath(cred)
  if (!full) return // 根路径无需创建
  const whole = await mkcolTolerant(cred, full)
  if (whole === null) return // 成功或已存在

  if (whole.status === 409) {
    const segments = full.split('/').filter(Boolean)
    let pathAcc = ''
    for (const seg of segments) {
      pathAcc += '/' + seg
      const r = await mkcolTolerant(cred, pathAcc)
      if (r !== null) {
        throw new Error(`创建目录失败 (HTTP ${r.status})：${backupOrigin(cred)}${pathAcc}`)
      }
    }
    return
  }

  throw new Error(
    `创建目录失败 (HTTP ${whole.status})：${backupOrigin(cred)}${full}` +
    (whole.status === 403 ? '（无权限，检查账号/应用密码）' : whole.status === 404 ? '（地址路径不存在，确认 WebDAV 地址格式）' : ''),
  )
}

/** 执行 MKCOL；2xx/405 返回 null（视为成功），其余返回响应 */
async function mkcolTolerant(cred: WebdavCred, path: string): Promise<WdResponse | null> {
  try {
    const r = await wdRaw(cred, 'MKCOL', backupOrigin(cred) + path)
    if (r.ok || r.status === 405) return null
    return r
  } catch (e) {
    if (e instanceof TypeError && e.message.startsWith(FETCH_FAILED)) throw e
    if (e instanceof TypeError) throw new TypeError(FETCH_FAILED)
    throw e
  }
}

export interface SyncResult {
  ok: boolean
  message: string
}

/** 根路径不可写时的兜底子目录 */
const FALLBACK_DIR = '/xiangqi'

/** 上传全量备份到云端；根路径 404 时自动改用 /xiangqi 子目录并回写设置 */
export async function uploadBackup(cred: WebdavCred): Promise<SyncResult> {
  try {
    await ensureCollection(cred)
    const json = exportFullBackup()
    let r = await wdRaw(cred, 'PUT', backupUrl(cred), json)
    if (r.status === 404 && collectionPath(cred) === '') {
      // 根目录不可写（如 rclone 挂载远端根）：换兜底子目录重试
      const alt: WebdavCred = { ...cred, url: cred.url + FALLBACK_DIR }
      await ensureCollection(alt)
      r = await wdRaw(alt, 'PUT', backupUrl(alt), json)
      if (r.ok || r.status === 201 || r.status === 204) {
        saveCredToSettings(alt)
        markLastSync()
        return { ok: true, message: `已备份到云端 ${FALLBACK_DIR}/（原地址根目录不可写，已自动改用子目录并更新设置）` }
      }
    }
    if (!r.ok && r.status !== 201 && r.status !== 204) {
      const hints: Record<number, string> = {
        401: '账号或密码错误',
        403: '服务器拒绝写入',
        404: '目录不存在，尝试在地址末尾加子目录',
        405: '服务器不允许写入——若用 rclone serve webdav，请检查是否带了 --read-only 或后端不支持上传',
      }
      return { ok: false, message: `上传失败 (HTTP ${r.status})：${backupUrl(cred)}${hints[r.status] ? '（' + hints[r.status] + '）' : ''}` }
    }
    markLastSync()
    return { ok: true, message: `已备份到云端（${(json.length / 1024).toFixed(0)} KB）` }
  } catch (e) {
    return readable(e)
  }
}

/** 从云端拉取备份并合并恢复；根路径无文件时尝试 /xiangqi 子目录 */
export async function downloadBackup(cred: WebdavCred): Promise<SyncResult> {
  try {
    let r = await wdRaw(cred, 'GET', backupUrl(cred))
    if (r.status === 404 && collectionPath(cred) === '') {
      const alt: WebdavCred = { ...cred, url: cred.url + FALLBACK_DIR }
      r = await wdRaw(alt, 'GET', backupUrl(alt))
      if (r.ok) {
        saveCredToSettings(alt)
        return finishDownload(r.text, `（于 ${FALLBACK_DIR}/ 找到，已更新设置为该子目录）`)
      }
    }
    if (r.status === 404) return { ok: false, message: '云端暂无备份' }
    if (!r.ok) {
      return { ok: false, message: `下载失败 (HTTP ${r.status})：${backupUrl(cred)}${r.status === 401 ? '（账号或密码错误）' : ''}` }
    }
    return finishDownload(r.text)
  } catch (e) {
    return readable(e)
  }

  function finishDownload(json: string, suffix = ''): SyncResult {
    const s = importFullBackup(json)
    const parts = [
      s.games > 0 ? `新增 ${s.games} 局` : null,
      s.settingsMerged ? '设置已合并' : null,
      s.mistakes > 0 ? `错题 +${s.mistakes}` : null,
      s.ratingRestored ? '棋力分已恢复' : null,
    ].filter(Boolean)
    markLastSync()
    return { ok: true, message: parts.length ? `云备份恢复：${parts.join(' · ')}${suffix}` : `云端与本机一致${suffix}` }
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

// ── 连接诊断：自动探测可写位置 ────────────────────────────────────

export interface DiagStep {
  name: string
  ok: boolean
  detail: string
}

export interface DiagResult {
  steps: DiagStep[]
  /** 探测到的可写目录路径（相对 origin），与配置不同时提示采用 */
  workingPath?: string
}

/** 候选可写目录：用户配置的路径优先，其次常见约定 */
function candidatePaths(cred: WebdavCred): string[] {
  const configured = collectionPath(cred)
  const list = [configured || '/', '/webdav/data', '/webdav', '/xiangqi']
  const seen = new Set<string>()
  return list.filter(p => {
    const norm = p.replace(/\/+$/, '') || '/'
    if (seen.has(norm)) return false
    seen.add(norm)
    return true
  })
}

/**
 * 依次探测：服务器连通 → 各候选目录 MKCOL+PUT+DELETE 往返。
 * 找到第一个可写目录即返回 workingPath。
 */
export async function diagnoseConnection(cred: WebdavCred): Promise<DiagResult> {
  const steps: DiagStep[] = []
  const push = (name: string, ok: boolean, detail: string) => { steps.push({ name, ok, detail }) }

  // 1. 服务器连通 + DAV 能力
  try {
    const o = await wdRaw(cred, 'OPTIONS', backupOrigin(cred) + '/')
    push('服务器连通', true, `HTTP ${o.status}`)
  } catch (e) {
    push('服务器连通', false, readable(e).message)
    return { steps }
  }

  // 2. 候选目录写探针：MKCOL → PUT → DELETE 往返
  let workingPath: string | undefined
  for (const dir of candidatePaths(cred)) {
    const probeRel = `${dir === '/' ? '' : dir}/xiangqi-probe-${Date.now() % 10000}.txt`
    const probeUrl = `${backupOrigin(cred)}${probeRel}`
    try {
      const mk = await wdRaw(cred, 'MKCOL', backupOrigin(cred) + (dir === '/' ? '/' : dir))
      const put = await wdRaw(cred, 'PUT', probeUrl, 'probe')
      if (put.ok) {
        await wdRaw(cred, 'DELETE', probeUrl).catch(() => undefined)
        push(`写入探测 ${dir}`, true, `PUT HTTP ${put.status}${mk.status === 405 ? ' · 目录已存在' : mk.ok ? ' · 已自动创建' : ''}`)
        workingPath = dir
        break
      }
      push(`写入探测 ${dir}`, false, `PUT HTTP ${put.status}`)
    } catch (e) {
      push(`写入探测 ${dir}`, false, readable(e).message)
    }
  }

  if (!workingPath) push('结论', false, '所有候选位置均不可写；确认服务端挂载点后手动填写完整目录地址')
  else if (workingPath !== collectionPath(cred)) push('结论', true, `发现可写目录 ${workingPath}（当前配置为 ${collectionPath(cred) || '/'}），可点击"采用"`)
  else push('结论', true, `配置的目录可用`)
  return { steps, workingPath }
}
