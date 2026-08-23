#!/usr/bin/env node
/**
 * CI 签名配置注入
 *
 * 在 CI 生成的全新 Capacitor android 工程上：
 *   0. 从 package.json 注入 versionCode / versionName（模板默认 1.0/1 必须改写）
 *   1. 从 Secrets 解码 keystore 文件
 *   2. 写入 android/key.properties
 *   3. 改写 android/app/build.gradle 的 release 构建直接使用签名属性
 *
 * 所需环境变量（GitHub Actions Secrets）:
 *   ANDROID_KEYSTORE_BASE64    keystore 文件的 base64
 *   ANDROID_KEYSTORE_PASSWORD  keystore 密码
 *   ANDROID_KEY_ALIAS          别名
 *   ANDROID_KEY_PASSWORD       别名密码（可选，默认同 keystore 密码）
 *
 * 未配置 Secrets 时仅注入版本号并跳过正式签名（退出码 0），由工作流回退 debug 构建。
 */

import { writeFileSync, readFileSync, existsSync, cpSync } from 'fs'
import { join } from 'path'

// ── 0. 版本号注入（与签名无关，总是执行） ──────────────────────────
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const [maj = 0, min = 0, patch = 0] = String(pkg.version || '').split('.').map(n => parseInt(n) || 0)
const versionCode = maj * 10000 + min * 100 + patch
const versionName = `${maj}.${min}`

const androidDir0 = join(process.cwd(), 'android')
if (!existsSync(androidDir0)) {
  console.error('[ci-sign] android 目录不存在，请先执行 cap add android')
  process.exit(1)
}

// ── 自定义启动图标回填 ─────────────────────────────────────────────
// android/ 不入库，图标产物随仓库 resources/icons/ 分发（npm run icons 生成的拷贝）
{
  const iconsSrc = join(process.cwd(), 'resources', 'icons')
  if (existsSync(iconsSrc)) {
    cpSync(iconsSrc, join(androidDir0, 'app', 'src', 'main', 'res'), { recursive: true })
    console.log('[ci-sign] 已回填自定义启动图标')
  }
}

const gradlePath0 = join(androidDir0, 'app', 'build.gradle')
let gradle0 = readFileSync(gradlePath0, 'utf-8')
gradle0 = gradle0.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
gradle0 = gradle0.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`)
writeFileSync(gradlePath0, gradle0)
console.log('[ci-sign] 已注入版本 versionCode=%d versionName=%s', versionCode, versionName)

// ── 正式签名（可选） ───────────────────────────────────────────────
const b64 = process.env.ANDROID_KEYSTORE_BASE64
const storePass = process.env.ANDROID_KEYSTORE_PASSWORD
const alias = process.env.ANDROID_KEY_ALIAS
const keyPass = process.env.ANDROID_KEY_PASSWORD || process.env.ANDROID_KEYSTORE_PASSWORD

if (!b64 || !storePass || !alias) {
  console.log('[ci-sign] 未配置签名 Secrets（ANDROID_KEYSTORE_BASE64 / PASSWORD / ALIAS），回退 debug 签名')
  process.exit(0)
}

const androidDir = join(process.cwd(), 'android')
if (!existsSync(androidDir)) {
  console.error('[ci-sign] android 目录不存在，请先执行 cap add android')
  process.exit(1)
}

// 1. 解码 keystore
const keystorePath = join(androidDir, 'app', 'upload-keystore.jks')
writeFileSync(keystorePath, Buffer.from(b64, 'base64'))

// 2. key.properties（storeFile 相对 app 模块）
writeFileSync(join(androidDir, 'key.properties'), [
  `storeFile=upload-keystore.jks`,
  `storePassword=${storePass}`,
  `keyAlias=${alias}`,
  `keyPassword=${keyPass}`,
].join('\n'))

// 3. 补丁 build.gradle：release 块内替换 debug 签名引用为 key.properties 属性
const gradlePath = join(androidDir, 'app', 'build.gradle')
let gradle = readFileSync(gradlePath, 'utf-8')

const signingProps = [
  '            storeFile file(keystoreProperties[\'storeFile\'])',
  '            storePassword keystoreProperties[\'storePassword\']',
  '            keyAlias keystoreProperties[\'keyAlias\']',
  '            keyPassword keystoreProperties[\'keyPassword\']',
].join('\n')

// 在 android { 块前注入 Properties 加载逻辑
const loaderBlock = [
  "import java.util.Properties",
  "import java.io.FileInputStream",
  '',
  'def keystorePropertiesFile = rootProject.file("key.properties")',
  'def keystoreProperties = new Properties()',
  'if (keystorePropertiesFile.exists()) {',
  '    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))',
  '}',
  '',
].join('\n')

if (!gradle.includes('keystoreProperties')) {
  gradle = loaderBlock + '\n' + gradle
}

// release buildTypes 内的 debug 签名引用 → 正式签名属性
if (!gradle.includes('storeFile file(keystoreProperties')) {
  gradle = gradle.replace(
    /^(\s*)signingConfig signingConfigs\.debug\s*$/m,
    `$1${signingProps.replace(/\n\s*/g, '\n$1')}`,
  )
}

writeFileSync(gradlePath, gradle)
console.log('[ci-sign] 已配置正式签名（alias: %s），release 构建将使用上传密钥', alias)
