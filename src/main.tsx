import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useStore } from './store/useStore'
import { getLegalMoves } from './game/rules'

// 暴露 store 供调试/自动化测试使用
;(window as any).__store = useStore
;(window as any).__getLegalMoves = getLegalMoves

// PWA: 仅生产环境注册 Service Worker（离线缓存）
// 新版本检测: SW 采用 skipWaiting+clients.claim，接管页面时触发 controllerchange，
// 由 App 渲染"新版本已就绪"横幅（首访无旧控制器，不误报）。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let hadController = !!navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return
      window.dispatchEvent(new CustomEvent('xiangqi-update-ready'))
    })
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // 长驻 SPA 页面不会自动重查更新，每小时主动检查一次
      setInterval(() => { reg.update().catch(() => {}) }, 60 * 60 * 1000)
    }).catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
