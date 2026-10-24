# 开发与目录

开发规则统一维护在 [agent.md](../agent.md)。当前技术栈为 Electron、React、TypeScript、SQLite 与 Three.js。主进程负责计时、时间余额、兑换和文件事务；渲染进程仅通过受限 IPC 操作。

## 只保留两个源码位置

- 主目录 `Projects/study-workbench`：main 已合并源码，与 GitHub 同步；不安装依赖或生成输出。
- 开发目录 `Projects/study-workbench-dev`：唯一功能工作树，全部修改和测试在这里进行；交付完成后清空。
- 正式程序与 `%APPDATA%/study-workbench` 真实数据独立，不用于开发测试。

开始先核对两个目录的 git status、git worktree list 和远端 main。接续已有未完成工作，不能覆盖。新工作从已同步的 main 创建一个功能分支。

## 源码入口

| 位置                                          | 职责                                                                |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `src/main/main.ts` / `preload.ts`             | 窗口、系统暂停、序列化 IPC、沙箱桥接                                |
| `src/main/time.ts`                            | 单调计时与跨日切片                                                  |
| `src/main/store.ts`                           | 学习账本、时间商店、幂等命令、审计                                  |
| `src/main/schema.ts` / `migrations/`          | 原始 schema 与增量迁移，历史 checksum 不改                          |
| `src/main/files.ts`                           | 附件去重、数据集、备份恢复、缓存回收                                |
| `src/shared/contracts.ts`                     | IPC 校验与共享类型                                                  |
| `src/renderer/App.tsx`                        | 导航与快照装配                                                      |
| `Home.tsx` / `ResourceLibrary.tsx` / `pages/` | 首页、课程资料、记录、时间商店、设置                                |
| `src/renderer/Tank.tsx`                       | 唯一水面场景，没有礼物模型或物理引擎                                |
| `style.css` / `tokens.css`                    | 统一样式入口与主题变量                                              |
| `tests/`                                      | 时钟、事务、历史升级、备份故障、真实 Electron 回归                  |
| `scripts/`                                    | 构建、许可、安装、视觉和性能检查                                    |
| `public/assets/` / `build/`                   | 正式离线素材、许可与安装器品牌输入                                  |
| `docs/`                                       | 本页、历史追溯、验收摘要和少量正式截图                              |
| `.artifacts/`                                 | 全部可再生成输出：build、tests、fixtures、data、tmp、cache、release |

## 测试与发行

始终设置隔离 STUDY_DATA_DIR 与工作树内 TEMP/TMP。`npm run check` 运行必要功能检查。视觉修改运行 `test:visual`；发行执行 `dist:win`，将候选安装到 `.artifacts/install` 后设置 STUDY_SMOKE_EXE 运行 `test:installed`。不要用真实学习库或正式安装做故障实验。

内存定位用 `node scripts/performance.mjs --diagnostic`（60 秒原生分配采样）。正式内存验收 `npm run test:memory` 先执行 20 轮页面切换和 100 次真实时间兑换，再固定暖机 5 分钟，最后至少 60 分钟正式采样，不强制 GC、不定时清缓存。统计总 private bytes 的暖机末 5 次与正式末 20 次中位数差，目标不超过 16MiB；记录 JS 堆、DOM、监听器和实际绘制帧间隔。

通过检查并自审后创建中文完整功能提交，推送功能分支、开 PR，等待 Windows CI。确认 main 未变化后中文 squash 合并，主目录 pull --ff-only 同步并核对远端 SHA。标签指向已验收的合并提交；Release 仅上传完整 Setup.exe、SHA256SUMS.txt 和中文说明。安装产物不入源码。

交付后确认 GitHub 可恢复、测试进程退出且无独有未提交内容，再移除工作树和已合并分支。旧草稿源码归档保留在用户交接资料中，临时安装、依赖和测试输出可清理。Git 历史保留，旧测试 Release 与 v0.x 标签按本次用户要求清除。
