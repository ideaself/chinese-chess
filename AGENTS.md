# 中国象棋 App - 项目状态与开发指南

## 项目概览

React + TypeScript + Vite 的中国象棋应用（Web + Android/Capacitor）。
核心功能：人机对战（Pikafish WASM）、复盘分析、大师棋谱库、名局拆解训练、AI 教练（DeepSeek）。

- **当前版本**: v1.23.0（version.ts / package.json / android build.gradle 三处同步）
- **仓库**: github.com/ideaself/chinese-chess（main 分支）
- **数据源**: `../chinese-chess-qipu/data/raw/dpxq_master/` 东萍棋谱语料（全量 ~14.2 万局）；整理库 `../xiangqi-qipu/chess.db`（similar 索引/insights 由此生成）

## 常用命令

```bash
npm test                # vitest 单测（253 项）
npx tsc --noEmit        # 类型检查
npm run build           # tsc + vite build → dist/
npm run e2e             # 需先 build；e2e 冒烟（6 套件），E2E_SUITES=master 可过滤套件
                        # 注意：移动套件 17 项按 v1.18 前旧导航编写已失效；角色 1 项（提示箭头）为基线旧失败
npm run dpxq            # 语料 → public/master-games/ 分片（mtime 增量缓存 v2，UCI 格式）
npm run book            # 语料 → public/opening-book.json 大数据开局书
# Android 发布: build → npx cap sync android（必须仓库根目录执行）→ npm run android:engine（注入原生引擎）→ cd android && ./gradlew assembleRelease
# 发布流程: 改三处版本号 → 构建 APK 拷入 releases/ → commit → push main + tag vX.Y.Z（CI 自动出 Release）
```

## 架构要点

- `src/game/dhtmlxq.ts` DhtmlXQ 解析；**分片数据 mv 统一为 UCI 连写**（历史 bug：曾混用 dpxq 坐标导致分类失效，勿回退）
- `src/game/storage.ts` IndexedDB 存储（同步 API + 内存镜像，initGameStorage 在 store.init 调用）；设置/拆解错题仍在 localStorage；DB v2 另有 `master_analysis` store（异步按需读写，不进内存镜像）
- `src/game/progress.ts` 训练进度统一模型（v1.21）：题库题型/难度统计+连对+每日完成、残局通关、错题重练记录；localStorage 同步 API；全量备份 v3 新增 `trainingProgress` 段（合并语义=计数取最大/完成并集）
- `src/game/masterPreanalysis.ts` 大师局批量预分析：关键点（吃子/将军手 k 与 k+1）深度 12 缓存到 IDB；拆解殊途同归判定缓存优先（即时）+ 实时结果写透；关键手优先选"大师与引擎分歧最大"处；批量入口在大师库页头，引擎忙时让路可停止
- `src/game/masterLibrary.ts` 棋谱库分类（开局体系/黑方应法/胜率统计）；分片懒加载 manifest+shard；manifest 含 maxId/ranges，`fetchGameById` 按 id 定点取单局（不全量加载）；全量 141k 局下大师库页渐进载入（首屏 30 片+续载按钮）
- `src/game/book.ts` 开局书：大数据 JSON + 内置定式兜底，按行棋方视角过滤（注意浮点容差 1e-9）
- `src/game/evalScore.ts` 评估分视角统一：**引擎分是行棋方视角**，界面/AI 教练一律按红方视角，转换只走 `toRedScore/fenTurn/redScoreFromFen`（曾出现 AnalysisPanel/CoachPanel 黑方行棋时红黑颠倒）
- `src/game/puzzles.ts` 题库难度按**局面事实**分档（非掉分）：初级=一步杀 / 中级=已是必胜局面 / 高级=均势找最佳着；`puzzleTask` 按局面判定任务类型（杀王/防守/找最佳着，题库有 62 道「杀局」实为败势防守题）；`puzzleDropText` 绝杀级分差不显示 cp。`puzzleFacts` 有模块级缓存，首轮 600 题约 120ms
- `src/game/rules.ts` `hasLegalMove`：提前退出的将死判定，批量分级用（等价于 `getAllLegalMoves().length > 0`）
- 题库答题闭环：`nextLibraryPuzzle` 同题型/同难度换题（PuzzlePanel「下一题」，不再做完只能退出）；`exitPuzzle` 还原进入题库前的对局（题库题是单步合成棋局，历史上退出会停在"假复盘"）；`puzzleTryMove` 答错后异步请引擎判定"殊途同归"（深度 12，与名局拆解同机制，改判后 `amendPuzzleWrongToRight` 回滚战绩）；分级提示 `puzzleHintPiece`/`puzzleHintNature`（子力 → 着法性质，不直接给答案），store 侧 `puzzleHintLevel`；答对自动 / 看答案手动 `loadPuzzleLine`（搜答案走完后的局面，给出中文后续变化线，回答"为什么"）；残局训练结算弹窗「下一关/返回训练」+ `exitEndgameTraining`（桌面返回键此前漏了残局分支）；连续换题/下一关保留最初来源页（`replayOrigin` 只在非链式进入时刷新）
- `src/game/openings.ts` 开局训练线路：`getOpeningLines()` 优先用开局书生成（`buildOpeningLinesFromBook`：取语料一步键按到达局数排序，沿主线走 `BOOK_LINE_PLIES=10` 手，`MIN_LINE_GAMES=100` 过滤冷门首着，名称复用 `openingClassify`），否则用 4 条内置定式；`ensureBookOpeningLines()` 幂等生成。开局进度在 `progress.openings`（attempts/completed），训练面板显示 ✓/尝试次数
- `src/game/openingClassify.ts` 开局分类（从 masterLibrary 抽出的纯函数，避免棋谱库加载代码进主包）：`classifyFamily/classifyDefense/classifyRecord` + `FAMILY_INFO/DEFENSE_INFO`；飞相局已补 `g0e2`(相七进五)
- `src/game/mateSearch.ts` 强制取胜搜索（纯规则、无引擎）：AND-OR 搜索 + 局面记忆化 + **着法级节点预算**（默认 300k，含应手生成开销）；用于校验残局预设是否真的能赢。残局预设回归测试覆盖：FEN 必须 10 段、红方初始不被将且有着、黑方非退化、杀型预设一步杀唯一、文案棋子与局面一致
- `src/game/playerIdentity.ts` 玩家身份解析：内建对局认 header 的 `'玩家'`，导入棋谱按设置「我的棋手名」匹配红/黑方；`storage.playerSideOfGame` 统一入口（错题本/弱点分析/战绩/对局总结/统计页均走它，勿再写死 `'玩家'`）
- 状态: zustand `src/store/useStore.ts`（组合入口，34 行）+ `slices/` 8 个领域切片（game/engine/masterQuiz/puzzle/variation/setup/opening/ui）+ `types.ts`（AppState）+ `constants.ts`（难度表）+ `helpers.ts`（纯函数）。跨 slice 调用一律经 get()；模块级可变量在各 slice 文件内
- 导航可达性：训练页含「名局拆解」入口；移动端只 setTab 会失效（按 mobilePage 渲染），统计页训练计划按钮、大师参考跳转均已补 setMobilePage；大师参考跳转不再打开空白「错题练习」浮层
- 对局角色 sideControl {w,b}: 玩家|AI 每方独立，支持双人/AI演示；演示局不入棋谱库、不计 Elo
- AI 教练: `src/game/coach/aiCoach.ts`（流式 SSE + 多轮对话；开发走 vite proxy `/ai-proxy` → api.deepseek.com）
- 原生引擎（Android）：`android-native/NativePikafishPlugin.java` + `MainActivity.java`（注册 `NativePikafish` 插件）；引擎二进制必须以 jniLibs 形式打包（`libpikafish.so` / `libpikafish_baseline.so` + Manifest `extractNativeLibs="true"`），因为 Android 10+ 禁止执行应用数据目录里的文件（曾用 assets 解压 + chmod，报 error=13 Permission denied）；NNUE 权重仍走 assets（`public/engine/pikafish.nnue`）解压到 filesDir。`npm run android:engine` 在 `cap add android` 之后一键注入（默认从 `../Pikafish.2026-01-02` 取，可用 `--src` 覆盖）；缺引擎时脚本跳过、App 自动回退 WASM。**CI 出的包不含原生引擎**（二进制不入库）
- 签名：`android/app/upload-keystore.jks` + `android/key.properties`（alias `m`，2026-09 重新生成；旧 keystore 已丢失 → 换新密钥后与历史安装签名不一致，覆盖安装需先卸载旧包）。本地出正式包：`npm run build && npx cap sync android && npm run android:engine && cd android && ./gradlew assembleRelease`
- opencode.json 已开 YOLO 权限模式

## 近期完成（v1.7.0）

开局胜率统计、分支推演、名局拆解（关键手模式+引擎殊途同归判定）、残局定式库11种、
IndexedDB、CI 自动发布（ci-sign.mjs 支持 secrets 正式签名）、分片棋谱库、流式多轮 AI 教练、
PWA（已有基础）、列表分页、语料去重、e2e 大师库套件。
v1.7.0 后（未发版）：大师局批量预分析缓存 IDB（拆解判定即时化/关键手更精准，单测 112 项）；
全量备份/恢复（棋谱+设置+拆解战绩/错题/掌握度+棋力分，合并语义，兼容旧 v1 备份，单测 117 项）；
对局角色（双人/AI演示/随机执子）；拆解局自动预热+缓存物化点亮复盘；PWA 更新提示；
useStore 拆分 slices 架构（行为零改动，tsc/124 单测/e2e 全绿）；
SW 缓存名随包版本自动更新（scripts/bump-sw.cjs）。
云同步（WebDAV）：v1.13.7 起恢复（此前因用户服务端只读 rclone 405 移除过，服务端已修复）。
设置页「云同步(WebDAV)」分组：地址/账号/密码 + 备份到云端/从云端恢复/连接诊断；
开发经 vite `/__webdav` 反代，App 原生直连；本地备份/恢复保留。
v1.21（未发版，计划见 docs/v1.21-plan.md）：训练闭环（progress.ts 统一进度/自适应出题/错题重练自动掌握/
残局通关记录/主页每日一题卡片）、统计图表（胜率走势+阶段损失条形图）、任意局面导出+Web Share 分享、
WebDAV 自动同步+3 份历史轮换（WebDAV COPY）、全量备份 v3 含训练进度、
WebDAV 密码迁入 SecureStorePlugin（Android Keystore EncryptedSharedPreferences，Web 回退 localStorage）、
次级面板 React.lazy+空闲预取（主包 373→335KB，e2e 需预取后才可断言页面元素）；
similar.ts 解除 5 万局上限（全量重切 141k 局 142 分片，manifest maxId/ranges 驱动，
fetchGameById 定点取局，大师库页渐进载入；dpxq 解析缓存移 .cache/ 不入库）。

v1.22.0（本次发布）：教学向修复与闭环补全——评估分视角统一（AnalysisPanel/CoachPanel/AI 教练）、题库难度改按局面事实分档（600 题原全判高级）+ 任务类型（杀王/防守/找最佳着）+ 掉分文案；答题闭环（下一题/退出还原对局/引擎殊途同归改判/分级提示/后续变化线）；导入棋谱进闭环（我的棋手名）；SRS 间隔复习（1/3/7/21/60 天 + 今日复习队列）；开局训练改语料驱动（开局书生成线路 + 进度记录）；残局预设内容修正（单车 FEN 缺段、闷宫/铁门栓改为可胜的一步杀）+ mateSearch 强制取胜校验；导航可达性修复；Android 原生 Pikafish 引擎集成（jniLibs + 插件 + npm run android:engine）。

v1.23.0（本次发布）：AI 收官纠偏——必胜局面下引擎反复将军不推进时（Pikafish 在近似赢法间摇摆，实测加时无改善），应用层从 MultiPV 候选换成分数接近（≤50cp）的非将军着（`src/game/aiEndgame.ts`，仅大师/特级大师生效）；桌面 WebSocket 桥修 cwd/权重发现（server 按二进制附近找 pikafish.nnue 并设为引擎 cwd，修复引擎加载不到权重直接退出的问题）。

## 已评估搁置

- 多线程 WASM 引擎：**已取消（用户 2026-09-03 确认）**。当前原生进程版二进制性能很好，无需 MT WASM。
  历史评估：无维护中的新版 MT 构建，且需 COOP/COEP 跨源隔离基建。基准工具留存 /tmp/opencode/mtbench/。

## 待办候选

- e2e 移动套件按 v1.19 新导航重写（现 17 项失效）；角色套件提示箭头基线失败排查

## CI 说明

- `.github/workflows/release.yml`：tag `v*` 或手动 dispatch 触发；npm ci → 单测 → build →
  `cap add android` → 版本注入 → 放行明文 HTTP → `scripts/ci-sign.mjs` → gradlew → GitHub Release。
  **已移除 Gitee 镜像步骤**（连续三次失败）；**签名 Secrets 已于 2026-09 换为新 keystore**，
  CI 包与本地包同签名、可互相覆盖升级。CI 包不含原生引擎（二进制不入库），需要引擎请用
  `chinese-chess-vX.Y.Z-engine.apk` 或本地按上面的流程自建。
