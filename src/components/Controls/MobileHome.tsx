/**
 * 移动端首页：三个大按钮导航
 */
import React from 'react'
import { useStore } from '../../store/useStore'
import type { MobilePage } from '../../store/slices/uiSlice'

const MENU_ITEMS: { page: MobilePage; icon: string; label: string; desc: string }[] = [
  { page: 'play', icon: '♟', label: '对战', desc: '人机对战 / 双人对弈' },
  { page: 'games', icon: '📖', label: '棋谱', desc: '大师棋局 / 复盘分析' },
  { page: 'settings', icon: '⚙', label: '设置', desc: '外观 / 音效 / 引擎' },
]

export const MobileHome: React.FC = () => {
  const setMobilePage = useStore(s => s.setMobilePage)

  return (
    <div className="mobile-home">
      <div className="mobile-home-title">♟ 中国象棋</div>
      <div className="mobile-home-menu">
        {MENU_ITEMS.map(item => (
          <button
            key={item.page}
            className="mobile-home-btn"
            onClick={() => setMobilePage(item.page)}
          >
            <span className="mobile-home-icon">{item.icon}</span>
            <span className="mobile-home-label">{item.label}</span>
            <span className="mobile-home-desc">{item.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
