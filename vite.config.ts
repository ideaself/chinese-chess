import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
