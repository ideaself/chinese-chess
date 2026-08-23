# 中国象棋 App - 项目状态与开发指南

## 项目概览

React + TypeScript + Vite 的中国象棋应用（Web + Android/Capacitor）。
核心功能：人机对战（Pikafish WASM）、复盘分析、大师棋谱库、名局拆解训练、AI 教练（DeepSeek）。

- **当前版本**: v1.7.0（version.ts / package.json / android build.gradle 三处同步）
- **仓库**: github.com/ideaself/chinese-chess（main 分支）
- **数据源**: `../chinese-chess/data/raw/dpxq_master/` 东萍棋谱语料（持续下载中，~11万局）

## 常用命令

```bash
npm test                # vitest 单测（98 项）
npx tsc --noEmit        # 类型检查
npm run build           # tsc + vite build → dist/
npm run e2e             # 需先 build；e2e 冒烟（77+35 项），E2E_SUITES=master 可过滤套件
npm run dpxq            # 语料 → public/master-games/ 分片（mtime 增量缓存 v2，UCI 格式）
npm run book            # 语料 → public/opening-book.json 大数据开局书
# Android 发布: build → npx cap sync android（必须仓库根目录执行）→ cd android && ./gradlew assembleRelease
# 发布流程: 改三处版本号 → 构建 APK 拷入 releases/ → commit → push main + tag vX.Y.Z（CI 自动出 Release）
```

## 架构要点

- `src/game/dhtmlxq.ts` DhtmlXQ 解析；**分片数据 mv 统一为 UCI 连写**（历史 bug：曾混用 dpxq 坐标导致分类失效，勿回退）
- `src/game/storage.ts` IndexedDB 存储（同步 API + 内存镜像，initGameStorage 在 store.init 调用）；设置/拆解错题仍在 localStorage
- `src/game/masterLibrary.ts` 棋谱库分类（开局体系/黑方应法/胜率统计）；分片懒加载 manifest+shard
- `src/game/book.ts` 开局书：大数据 JSON + 内置定式兜底，按行棋方视角过滤（注意浮点容差 1e-9）
- 状态: zustand `src/store/useStore.ts`（单文件大 store，含 variation 推演/masterQuiz 拆解等）
- AI 教练: `src/game/coach/aiCoach.ts`（流式 SSE + 多轮对话；开发走 vite proxy `/ai-proxy` → api.deepseek.com）
- opencode.json 已开 YOLO 权限模式

## 近期完成（v1.7.0）

开局胜率统计、分支推演、名局拆解（关键手模式+引擎殊途同归判定）、残局定式库11种、
IndexedDB、CI 自动发布（ci-sign.mjs 支持 secrets 正式签名）、分片棋谱库、流式多轮 AI 教练、
PWA（已有基础）、列表分页、语料去重、e2e 大师库套件。

## 待办候选

- CI 配置签名 Secrets 后验证正式签名包（本地 keystore 见 android/key.properties，gitignored）
- 大师对局批量预分析缓存到 IDB（拆解关键点更精准）
- 云同步/备份到远端
- 多线程 WASM 引擎提升棋力
