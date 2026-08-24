#!/usr/bin/env node
/**
 * 构建后处理：把 dist/sw.js 的缓存名注入 package.json 版本号。
 * 版本变更 → 缓存名变化 → SW activate 时自动清理旧版本缓存。
 * （public/sw.js 保持占位符 v0.0.0，开发环境不受影响）
 */
const { readFileSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const swPath = join(root, 'dist', 'sw.js')

if (!existsSync(swPath)) {
  console.error('[bump-sw] dist/sw.js 不存在（先执行 vite build）')
  process.exit(1)
}

const sw = readFileSync(swPath, 'utf-8')
const next = sw.replace(
  /const CACHE = 'xiangqi-cache-v[^']*'/,
  `const CACHE = 'xiangqi-cache-v${pkg.version}'`,
)
if (next === sw) {
  console.warn('[bump-sw] 未找到缓存名占位符，sw.js 未修改')
  process.exit(0)
}
writeFileSync(swPath, next)
console.log(`[bump-sw] 缓存名 → xiangqi-cache-v${pkg.version}`)
