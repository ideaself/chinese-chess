# 中国象棋 App - 项目状态与开发指南

## 项目概览

React + TypeScript + Vite 的中国象棋应用（Web + Android/Capacitor）。
核心功能：人机对战（Pikafish WASM）、复盘分析、大师棋谱库、名局拆解训练、AI 教练（DeepSeek）。

- **当前版本**: v1.7.0（version.ts / package.json / android build.gradle 三处同步）
- **仓库**: github.com/ideaself/chinese-chess（main 分支）
- **数据源**: `../chinese-chess/data/raw/dpxq_master/` 东萍棋谱语料（持续下载中，~11万局）

## 常用命令

```bash
npm test                # vitest 单测（112 项）
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
- `src/game/storage.ts` IndexedDB 存储（同步 API + 内存镜像，initGameStorage 在 store.init 调用）；设置/拆解错题仍在 localStorage；DB v2 另有 `master_analysis` store（异步按需读写，不进内存镜像）
- `src/game/masterPreanalysis.ts` 大师局批量预分析：关键点（吃子/将军手 k 与 k+1）深度 12 缓存到 IDB；拆解殊途同归判定缓存优先（即时）+ 实时结果写透；关键手优先选"大师与引擎分歧最大"处；批量入口在大师库页头，引擎忙时让路可停止
- `src/game/masterLibrary.ts` 棋谱库分类（开局体系/黑方应法/胜率统计）；分片懒加载 manifest+shard
- `src/game/book.ts` 开局书：大数据 JSON + 内置定式兜底，按行棋方视角过滤（注意浮点容差 1e-9）
- 状态: zustand `src/store/useStore.ts`（组合入口，34 行）+ `slices/` 8 个领域切片（game/engine/masterQuiz/puzzle/variation/setup/opening/ui）+ `types.ts`（AppState）+ `constants.ts`（难度表）+ `helpers.ts`（纯函数）。跨 slice 调用一律经 get()；模块级可变量在各 slice 文件内
- 对局角色 sideControl {w,b}: 玩家|AI 每方独立，支持双人/AI演示；演示局不入棋谱库、不计 Elo
- AI 教练: `src/game/coach/aiCoach.ts`（流式 SSE + 多轮对话；开发走 vite proxy `/ai-proxy` → api.deepseek.com）
- opencode.json 已开 YOLO 权限模式

## 近期完成（v1.7.0）

开局胜率统计、分支推演、名局拆解（关键手模式+引擎殊途同归判定）、残局定式库11种、
IndexedDB、CI 自动发布（ci-sign.mjs 支持 secrets 正式签名）、分片棋谱库、流式多轮 AI 教练、
PWA（已有基础）、列表分页、语料去重、e2e 大师库套件。
v1.7.0 后（未发版）：大师局批量预分析缓存 IDB（拆解判定即时化/关键手更精准，单测 112 项）；
全量备份/恢复（棋谱+设置+拆解战绩/错题/掌握度+棋力分，合并语义，兼容旧 v1 备份，单测 117 项）；
对局角色（双人/AI演示/随机执子）；拆解局自动预热+缓存物化点亮复盘；PWA 更新提示；
useStore 拆分 slices 架构（行为零改动，tsc/124 单测/e2e 全绿）；
WebDAV 云同步（设置页凭据+一键备份/恢复全量备份，坚果云等兼容服务可用，单测 132/e2e 含角色套件）；
SW 缓存名随包版本自动更新（scripts/bump-sw.cjs）。

## 已评估搁置

- 多线程 WASM 引擎：现无维护中的新版 MT 构建；唯一现成的是 ousc/Pikafish-wasm 2023-03 版（引擎比当前
  single 的 dev-20240226 旧约一年，多线程收益大概率抵不过引擎/NNUE 代差），且需 COOP/COEP 跨源隔离基建。
  待条件成熟（本地 emsdk 构建新 MT 版）再启动。基准工具留存 /tmp/opencode/mtbench/。

## 待办候选

- CI 配置签名 Secrets 后验证正式签名包（本地 keystore 见 android/key.properties，gitignored）
- 远端同步增强：双向差异对比/自动定期备份（WebDAV 通道已就绪，待真实网盘联调）
- 多线程 WASM 引擎提升棋力（见"已评估搁置"）
