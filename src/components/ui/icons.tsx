/**
 * 内联 SVG 图标 —— 不依赖系统字体，任何设备渲染一致
 * （替代 ⏵ 等字体覆盖不全的 Unicode 符号 / emoji 风格不统一问题）
 *
 * 统一 24×24 线性图标，stroke=currentColor，随按钮文字色变化。
 */

import type { ReactNode } from 'react'

export type IconName =
  | 'undo' | 'hint' | 'flag' | 'draw' | 'flip' | 'gear' | 'more'
  | 'plus' | 'menu' | 'nav' | 'chart' | 'branch' | 'close'
  | 'prev' | 'next' | 'start' | 'end' | 'play' | 'pause' | 'list' | 'swap'
  | 'trophy' | 'book' | 'swords' | 'people' | 'robot' | 'star' | 'rotate' | 'camera'

const PATHS: Record<IconName, ReactNode> = {
  // 相机：拍照摆棋
  camera: <><path d="M4 8.5h3l1.4-2h7.2L17 8.5h3v10H4z" /><circle cx="12" cy="13" r="3.2" /></>,
  // 悔棋：回转箭头
  undo: <><path d="M9.5 14.5 4.5 9.5l5-5" /><path d="M4.5 9.5h9a6 6 0 0 1 0 12H10" /></>,
  // 提示：灯泡
  hint: <><path d="M9.5 18.5h5" /><path d="M10.5 21.5h3" /><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.6.5 1 1.2 1.1 2h5.4c.1-.8.5-1.5 1.1-2A6.5 6.5 0 0 0 12 2.5Z" /></>,
  // 认输：白旗
  flag: <><path d="M5.5 21.5V3.5" /><path d="M5.5 4.5c3.8-2 7.4 2 11.5 0v8c-4.1 2-7.7-2-11.5 0" /></>,
  // 求和：等号圆（和棋）
  draw: <><circle cx="12" cy="12" r="9" /><path d="M8 10.5h8M8 13.5h8" /></>,
  // 翻转：上下双箭头
  flip: <><path d="M7.5 4v13" /><path d="m3.5 13.5 4 4 4-4" /><path d="M16.5 20V7" /><path d="m12.5 10.5 4-4 4 4" /></>,
  // 设置：齿轮（Feather 造型）
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  // 更多：三点
  more: <><circle cx="5" cy="12" r="1.35" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.35" fill="currentColor" stroke="none" /></>,
  // 新对局：加号
  plus: <><path d="M12 5v14M5 12h14" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  // 导航：滑杆
  nav: <><path d="M4 8h7M17 8h3M4 16h3M13 16h7" /><circle cx="14" cy="8" r="2.2" /><circle cx="9" cy="16" r="2.2" /></>,
  // 分析：折线图
  chart: <><path d="M4 20V4M4 20h16" /><path d="m7.5 15 4-4.2 3 3L20 7.5" /></>,
  // 分支：树状
  branch: <><circle cx="6" cy="5.5" r="2.2" /><circle cx="6" cy="18.5" r="2.2" /><circle cx="18" cy="12" r="2.2" /><path d="M6 7.7v8.6" /><path d="M8.2 5.5h3.6A4.2 4.2 0 0 1 16 9.7v.6" /><path d="M8.2 18.5h3.6a4.2 4.2 0 0 0 4.2-4.2v-.6" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  prev: <><path d="m15 5-7 7 7 7" /></>,
  next: <><path d="m9 5 7 7-7 7" /></>,
  start: <><path d="M6 5v14" /><path d="M19.5 5 9.5 12l10 7Z" /></>,
  end: <><path d="M18 5v14" /><path d="M4.5 5 14.5 12l-10 7Z" /></>,
  play: <><path d="M8 5.2v13.6L19 12Z" /></>,
  pause: <><path d="M8.5 5v14M15.5 5v14" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" /></>,
  swap: <><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></>,
  // 奖杯（残局挑战）
  trophy: <><path d="M8 3.5h8v5a4 4 0 0 1-8 0Z" /><path d="M8 5H5.5v1.5A3.5 3.5 0 0 0 9 10" /><path d="M16 5h2.5v1.5A3.5 3.5 0 0 1 15 10" /><path d="M12 12.5V17" /><path d="M8.5 20.5h7" /><path d="M9.5 17h5" /></>,
  // 棋谱（书）
  book: <><path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H20v15H6.2A2.2 2.2 0 0 0 4 20.2Z" /><path d="M4 5.2V20.2" /><path d="M8 7.5h8" /></>,
  // 对战（棋子剪影）
  swords: <><circle cx="12" cy="7.2" r="3.5" /><path d="M9.6 11.1c-1.7 1.6-2.6 3.7-2.8 6.2h10.4c-.2-2.5-1.1-4.6-2.8-6.2" /><path d="M6.2 20.6h11.6" /></>,
  // 双人对战
  people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.6c2.6-.4 5 1.5 5 4.4" /></>,
  // AI 演示
  robot: <><rect x="4.5" y="8" width="15" height="11" rx="3.2" /><path d="M12 4v4" /><circle cx="12" cy="3" r="1" /><circle cx="9.3" cy="13.2" r="1.1" fill="currentColor" stroke="none" /><circle cx="14.7" cy="13.2" r="1.1" fill="currentColor" stroke="none" /><path d="M9.5 16.4h5" /></>,
  // 默认设置
  star: <><path d="m12 3.4 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.6l5.9-.8Z" /></>,
  // 旋转手机（横竖屏提示）
  rotate: <><rect x="9" y="6" width="6" height="12" rx="1.6" /><path d="M6.2 11a5.8 5.8 0 0 1 8.6-4.6" /><path d="M17.8 13a5.8 5.8 0 0 1-8.6 4.6" /><path d="M15.4 4.2v2.6h-2.6" /><path d="M8.6 19.8v-2.6h2.6" /></>,
}

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

export function TriRight({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      style={{ display: 'block', margin: '0 auto' }}
      aria-hidden="true"
    >
      <path d="M3.5 1.5 L12 7 L3.5 12.5 Z" fill="currentColor" />
    </svg>
  )
}
