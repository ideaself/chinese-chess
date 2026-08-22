/**
 * 内联 SVG 图标 —— 不依赖系统字体，任何设备渲染一致
 * （替代 ⏵ 等字体覆盖不全的 Unicode 符号）
 */

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
