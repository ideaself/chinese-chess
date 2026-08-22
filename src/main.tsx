import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useStore } from './store/useStore'

// 暴露 store 供调试/自动化测试使用
;(window as any).__store = useStore

// PWA: 仅生产环境注册 Service Worker（离线缓存）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
