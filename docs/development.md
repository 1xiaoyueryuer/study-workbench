# 开发与发行

推荐把唯一源码工作目录放在用户的 `Projects/study-workbench`，正式程序安装至 `%LOCALAPPDATA%/Programs/StudyWorkbench`，桌面保留应用快捷方式。程序数据始终位于 `%APPDATA%/study-workbench`。

## 本地流程

Node24/npm11，Windows x64；`npm ci`安装固定依赖并真实加载Electron的SQLite N-API模块。`npm run dev`从本地构建启动，`npm run check`执行整套检查。所有生成内容归入 `.artifacts`；无需提交该目录或node_modules。

构建输出 `.artifacts/build/main`、`.artifacts/build/renderer`；NSIS输出 `.artifacts/release/v0.4.0`。Electron44.4.5和better-sqlite3 13.0.3保持锁定，`npmRebuild:false`避免多余原生重建。打包使用已安装的Electron分发，首次NSIS工具下载仍需联网。

额外验收：

```powershell
npm run test:fixture
npm run test:visual       # 录屏需先 npx playwright install ffmpeg
npm run test:realtime     # 正常时钟10分钟
node scripts/draw-performance.mjs        # 完整绘制间隔5分钟
node scripts/collection-performance.mjs  # 内存60分钟
npm run test:installed   # 默认已安装的正式程序，独立临时userData
```

安装检查可通过 `STUDY_SMOKE_EXE` 指定可执行文件。真实旧版升级验收先把旧版安装到隔离目录，使用 `STUDY_UPGRADE_EXE` 指定该程序，运行 `scripts/upgrade-prepare.mjs` 建立基线，覆盖新版后运行 `scripts/upgrade-check.mjs`。两个脚本只作用于测试数据。历史安装包从对应历史发行取得；仓库不保留第二套正式程序。

素材再生成：`node scripts/collection-assets.mjs`。三个正式Kenney模型已在public，直接复用；需要重新取得原件时，把官方Nature Kit解压至 `.artifacts/cache/assets/nature`。来源、原文件、修改和hash见Collection/sources.json。

## 边界

shared/contracts.ts定义受限IPC输入与新增输出校验。time.ts管理单调计时；store.ts负责事务、检查点、幂等和审计；economy与collection处理积分及持久掉落；files.ts负责流式文件、副本去重、安全备份/恢复与回收。渲染页面不决定金额、随机结果或真实磁盘路径。

默认附件预算5GiB、每批100文件、单件1GiB；缓存256MiB LRU。自动安全备份通常最多2份/1GiB，最新一份保留；最近回滚generation保留7天。升级前安全备份过大或空间不足会阻止修改原库。内置图片/文本预览上限32MiB。

关闭窗口结算；异常退出只恢复可信检查点，不补记停机期间。检查点通常5秒，写盘失败可能丢失更多尾段。旧schema1→2保留旧时间与收据，积分从0开始，旧历史不补发宝贝。

## 公开发行

先完成 `npm run check`、`npm run dist:win` 和安装态检查，再计算Setup.exe的SHA-256并保存同目录SHA256SUMS.txt。使用GitHub CLI把明确的提交标记为v版本，上传Setup和哈希至Release；提交源码不包含安装产物、原始用户数据或本机日志。

```powershell
git push origin main
gh release create v0.4.0 .artifacts/release/v0.4.0/StudyWorkbench-0.4.0-Setup.exe .artifacts/release/v0.4.0/SHA256SUMS.txt --verify-tag --title "积水书房 0.4.0" --notes-file .artifacts/release-notes.md
```

历史设计保留在design/requirements.md，当前产品行为和限制以README与validation.md为准。公开分支使用GitHub的noreply提交邮箱；旧本地开发历史仅保留在本机local/history分支。
