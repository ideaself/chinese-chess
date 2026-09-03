/**
 * 安全社会存储（v1.21 凭据加固）
 *
 * - Android App: 走原生 SecureStore 插件（Android Keystore + EncryptedSharedPreferences）
 * - Web/开发环境: 回退 localStorage（与旧行为一致）
 *
 * 用于 WebDAV 密码等敏感凭据，避免明文留在普通 localStorage。
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

interface SecureStorePlugin {
  set(opts: { key: string; value?: string; ns?: string }): Promise<void>
  get(opts: { key: string; ns?: string }): Promise<{ value?: string | null }>
  remove(opts: { key: string; ns?: string }): Promise<void>
}

const plugin = Capacitor.isNativePlatform()
  ? registerPlugin<SecureStorePlugin>('SecureStore')
  : null

const NS = 'cred'

export async function secureSet(key: string, value: string): Promise<void> {
  if (plugin) {
    try { await plugin.set({ key, value, ns: NS }); return } catch { /* 落入回退 */ }
  }
  try { localStorage.setItem(`${NS}:${key}`, value) } catch { /* ignore */ }
}

export async function secureGet(key: string): Promise<string | null> {
  if (plugin) {
    try {
      const r = await plugin.get({ key, ns: NS })
      if (r.value !== null && r.value !== undefined) return r.value
    } catch { /* 落入回退 */ }
  }
  try { return localStorage.getItem(`${NS}:${key}`) } catch { return null }
}

export async function secureRemove(key: string): Promise<void> {
  if (plugin) {
    try { await plugin.remove({ key, ns: NS }) } catch { /* ignore */ }
  }
  try { localStorage.removeItem(`${NS}:${key}`) } catch { /* ignore */ }
}
