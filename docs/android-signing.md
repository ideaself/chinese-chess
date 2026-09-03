# Android 签名约定

本地和 GitHub Actions 必须使用同一个上传密钥，APK 才能覆盖安装和持续升级。

## 固定路径

- 密钥库：`android/app/upload-keystore.jks`
- 配置：`android/key.properties`
- 配置模板：[android-signing.properties.example](../android-signing.properties.example)

`android/` 是 Capacitor 生成目录，不提交密钥库和 `key.properties`。本地执行 `npx cap add android && npx cap sync android` 后，将同一份密钥库放到固定路径，并复制模板为 `android/key.properties`，填写真实密码和别名。

## GitHub Actions

仓库 Secret 使用以下名称，并且值必须对应本地同一份密钥库：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`（可选，默认使用 keystore 密码）

CI 会把 Secret 解码到 `android/app/upload-keystore.jks`，写入 `android/key.properties`，再构建 signed Release APK。不要提交 `.jks`、`key.properties` 或任何密码。
