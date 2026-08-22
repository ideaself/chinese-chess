/**
 * 中国象棋 Service Worker
 *
 * 策略:
 *   - 导航请求: 网络优先，离线回退缓存首页
 *   - 同源静态资源(含 wasm/皮肤): 缓存优先，首次访问时入缓存
 * 生产环境由 main.tsx 注册；更新机制: 版本号变更后旧缓存清理。
 */

const CACHE = 'xiangqi-cache-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // 页面导航: 网络优先，离线回退
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => {
          const cl = r.clone()
          caches.open(CACHE).then(c => c.put('/', cl))
          return r
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // 静态资源: 缓存优先
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit
      return fetch(req).then(r => {
        if (r.ok && r.type === 'basic') {
          const cl = r.clone()
          caches.open(CACHE).then(c => c.put(req, cl))
        }
        return r
      })
    })
  )
})
