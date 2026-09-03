#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm ci
npx vitest run
npm run build
npx cap add android
npx cap sync android

VERSION="$(node -p "require('./package.json').version")"
VERSION_CODE="$(node -p "const [major, minor, patch] = require('./package.json').version.split('.').map(Number); major * 10000 + minor * 100 + patch")"

sed -i "s/versionCode [0-9]*/versionCode ${VERSION_CODE}/; s/versionName \"[^\"]*\"/versionName \"${VERSION}\"/" android/app/build.gradle
sed -i 's|<application|<application\n        android:usesCleartextTraffic="true"|' android/app/src/main/AndroidManifest.xml

cd android
chmod +x gradlew
if [[ -f key.properties ]]; then
  ./gradlew assembleRelease
  APK="app/build/outputs/apk/release/app-release.apk"
else
  ./gradlew assembleDebug
  APK="app/build/outputs/apk/debug/app-debug.apk"
fi

mkdir -p ../apk-out
cp "$APK" "../apk-out/chinese-chess-v${VERSION}.apk"
printf 'APK: apk-out/chinese-chess-v%s.apk\n' "$VERSION"
