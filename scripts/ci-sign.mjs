#!/usr/bin/env node
/**
 * CI 签名配置注入
 *
 * 在 CI 生成的全新 Capacitor android 工程上配置正式签名：
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
 * 未配置 Secrets 时静默跳过（退出码 0），由工作流回退 debug 构建。
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const b64 = process.env.ANDROID_KEYSTORE_BASE64
const storePass = process.env.ANDROID_KEYSTORE_PASSWORD
const alias = process.env.ANDROID_KEY_ALIAS
const keyPass = process.env.ANDROID_KEY_PASSWORD || process.env.ANDROID_KEYSTORE_PASSWORD

if (!b64 || !storePass || !alias) {
  console.log('[ci-sign] 未配置签名 Secrets（ANDROID_KEYSTORE_BASE64 / PASSWORD / ALIAS），跳过正式签名')
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
