# 系统目录与接手指南

积水书房是离线 Windows 学习工作台：Electron 主进程与 SQLite 保管学习计时、积分、文件副本和收藏，React 页面提供书架、记录、商店、仓库与设置，Three.js 绘制前景水和收藏展示。运行不依赖开发服务器或云端账户，正式素材随安装包提供。

## 本地位置

| 位置 | 用途与约束 |
| --- | --- |
| `C:\Users\yuyu\Projects\study-workbench` | main 主仓库；与 GitHub 已合并源码同步，只读业务内容，不在这里开发测试 |
| `C:\Users\yuyu\Projects\study-workbench-dev` | 唯一开发工作树；一次一个功能分支，任务完成后删除工作树内容，保留空文件夹 |
| `%LOCALAPPDATA%/Programs/StudyWorkbench` | 唯一正式程序，由已验收安装包更新 |
| `%APPDATA%/study-workbench` | 用户真实 SQLite、附件和程序数据，不进 Git、不用作测试、不随清理删除 |
| 开发目录 `.artifacts` | 编译、测试、截图、隔离开发数据、缓存及待发布安装包，Git 忽略，交付后清理 |

桌面“积水书房”启动正式程序；“积水书房开发”打开主目录查看已交付源码。实际改代码要打开唯一开发工作树，不能在主目录直接编辑。GitHub 保存已提交内容；真实学习数据需要单独导出备份。

## 仓库目录

| 路径 | 职责 |
| --- | --- |
| `AGENTS.md` | 代理自动发现入口，要求先读 agent.md |
| `agent.md` | 唯一开发约束正文，含提交、测试、同步和清理规则 |
| `README.md` | 产品简介、下载、启动入口和文档索引 |
| `src/main/` | Electron 生命周期、系统能力、持久化、计时与业务事务 |
| `src/main/main.ts` | 窗口、单实例、锁屏/睡眠暂停、序列化 IPC、系统打开文件 |
| `src/main/preload.ts` | 隔离渲染进程与主进程，暴露受限 API 与真实 File 路径转换 |
| `src/main/time.ts` | 单调计时、暂停/恢复、可信检查点与跨日时间处理 |
| `src/main/store.ts` | SQLite 事务、幂等命令、查询快照和一致性审计 |
| `src/main/schema.ts`、`src/main/migrations/` | 历史 schema 与增量迁移；旧 checksum 不随重构改变 |
| `src/main/economy/` | 毫秒余额转积分、消费/出售、报价与确认事务 |
| `src/main/collection/` | 持久掉落轮次、概率、容量冻结和持有物规则 |
| `src/main/files.ts` | 数据集、文件副本去重、流式导入、备份恢复、缓存与空间回收 |
| `src/shared/` | 两端共享 IPC 契约、输入输出校验、收藏目录与类型 |
| `src/renderer/App.tsx` | 页面导航、共享快照和全局水层装配 |
| `src/renderer/Home.tsx`、`ResourceLibrary.tsx` | 学习首页、课程书架与资料管理 |
| `src/renderer/pages/` | 收藏、记录、仓库、商店和设置页面 |
| `src/renderer/components/` | 共享 UI、文件任务进度与掉落通知 |
| `src/renderer/Tank.tsx`、`scene/` | 前景水与六缸收藏的 Three.js 场景 |
| `src/renderer/*.css` | 主题变量、基础布局、水层、书房与收藏样式 |
| `tests/*.test.ts` | 单元、事务/备份、迁移、存储与视觉夹具测试 |
| `tests/e2e/` | 实际 Electron 界面的计时、收藏、拖放、书架和水层行为测试 |
| `scripts/` | 构建、原生模块检查、许可汇总、素材生成与安装/性能验收工具 |
| `public/assets/` | 运行时离线图标、植物、水纹、收藏模型与原始许可证 |
| `public/licenses.html`、`THIRD_PARTY_NOTICES.txt` | scripts/licenses.mjs 生成的应用内及文本第三方告知，需随发行更新 |
| `build/` | 安装器图标等品牌输入资源；不是编译输出目录 |
| `docs/development.md` | 工作树循环、测试命令、发行及故障恢复操作 |
| `docs/validation.md`、`docs/validation/` | 有范围和日期的实测摘要，不能将旧结果冒充新版本验收 |
| `docs/media/` | 少量可公开的代表截图；不保留运行日志或用户资料截图 |
| `docs/design/` | 历史需求与设计素材预览，仅作参考；当前约束优先 |
| `.github/workflows/` | Windows CI；干净机器安装锁定依赖并运行完整检查 |
| `package.json`、`package-lock.json` | 脚本、版本、打包配置与依赖锁定 |
| `vite.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.ts`、`playwright.config.ts` | 编译、类型、代码质量与测试配置 |
| `.gitignore`、`.gitattributes`、`.npmrc`、`.prettierignore` | 上传范围、文本规则、本地缓存与格式范围 |
| `.git` | 主仓库 Git 对象与工作树元数据；开发 worktree 的 .git 是指向它的文件 |
| `.artifacts/`、`node_modules/` | 只在开发工作树生成，任务交付后可清理，不上传源码 |

## 接手阅读与修改路径

先读根目录 agent.md，核对本地/远端 main 与唯一工作树状态；再读 README、开发流程及本页。按需求只深入相关模块，不需要先通读所有历史报告。

修改计时或积分：读 time.ts、store.ts、economy、shared/contracts.ts 与相关单元/升级测试。修改书架或文件：读 ResourceLibrary.tsx、FileTask、preload.ts、files.ts 和文件/备份测试。修改收藏：读 shared/collection.ts、collection/loot.ts、Collection 页面、CollectionScene 与收藏测试。修改存储：先核对旧 schema、迁移、审计和真实旧版本兼容要求。修改视觉：核对主题、全局水层、低动态/渲染失败退路以及 Electron 视觉/性能证据。

本机最近发行是 v0.4.0；以 package.json 和 GitHub Releases 的实时信息为准。测试报告保留当时的11项单元、25项集成/升级/存储、6项界面测试范围，后续增加功能时更新实际验收数和版本，不能照抄旧数量。正式许可目前为 UNLICENSED；公开仓库不自动代表授权开源使用，第三方各自许可继续适用。
