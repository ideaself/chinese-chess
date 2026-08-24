import { defineConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import https from 'node:https'

/**
 * 开发期 WebDAV 反代：/__webdav/* → 目标源（x-wd-target 头指定 origin）
 * 浏览器直连 WebDAV 会被 CORS 拦截，开发时经此转发。
 */
function webdavDevProxy() {
  return {
    name: 'webdav-dev-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__webdav', (req, res) => {
        const target = req.headers['x-wd-target']
        if (typeof target !== 'string' || !/^https?:\/\//.test(target)) {
          res.statusCode = 400
          res.end('missing x-wd-target')
          return
        }
        const fwdHeaders = { ...req.headers, host: new URL(target).host } as Record<string, string | string[] | undefined>
        delete fwdHeaders['x-wd-target']
        const mod = target.startsWith('https') ? https : http
        const fwd = mod.request(target + req.url, {
          method: req.method,
          headers: fwdHeaders,
        }, pr => {
          res.writeHead(pr.statusCode ?? 502, pr.headers)
          pr.pipe(res)
        })
        fwd.on('error', err => {
          res.statusCode = 502
          res.end('proxy error: ' + err.message)
        })
        req.pipe(fwd)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), webdavDevProxy()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // AI 教练（DeepSeek）开发代理，避免浏览器 CORS 限制
      '/ai-proxy': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/ai-proxy/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    exclude: ['public/wasm'],
  },
})
