# 开发、交付与恢复

先完整阅读根目录 [agent.md](../agent.md)。本页给出操作说明，约束只在 agent.md 维护。目录职责与模块入口见 [系统目录与接手指南](project-map.md)。GitHub 仓库为 https://github.com/1xiaoyueryuer/study-workbench 。

## 主目录与唯一开发工作树

主目录 `C:\Users\yuyu\Projects\study-workbench` 始终检出 main，只保存已合并源码；不要在这里安装依赖、修改代码或运行测试。开发位置 `C:\Users\yuyu\Projects\study-workbench-dev` 一次只挂一个功能工作树，没有开发任务时为空文件夹。安装好的正式程序与两者分开。

Git worktree 共享主仓库的历史与对象，各自文件、分支和 node_modules 独立；不是第二个 Git 克隆。开始与结束都核对远端，不承诺断网时实时同步。禁止把未完成改动搬进主目录。

## 开始一个完整功能

以下 PowerShell 命令在主目录执行。先确认没有未完成分支或活动开发工作树；如果有，就接续原任务，不覆盖创建。示例分支名需按实际功能更换。

```powershell
$main = 'C:\Users\yuyu\Projects\study-workbench'
$dev = 'C:\Users\yuyu\Projects\study-workbench-dev'
Set-Location $main
git status --short --branch
git worktree list
git fetch origin --prune
git pull --ff-only
git rev-parse HEAD origin/main
# HEAD 与 origin/main 一致、工作区干净，dev 不存在或为空，才能继续。
# 空的 dev 文件夹可作为 git worktree add 的目标；非空时不能覆盖。
git worktree add -b feat/course-bookshelf $dev main
Set-Location $dev
$env:TEMP = Join-Path $dev ".artifacts/tmp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
npm ci
$env:STUDY_DATA_DIR = Join-Path $dev '.artifacts/data/dev'
npm run dev
```

Node.js24/npm11，Windows x64。npm ci 由锁文件安装固定依赖，并实际加载 Electron 的 SQLite N-API 件。开发启动必须设置 STUDY_DATA_DIR，避免默认读取真实学习库；它只影响当前 shell，不要写成全局环境变量。

## 测试与文件范围

所有命令在开发工作树执行。编译输出为 `.artifacts/build/main` 和 `.artifacts/build/renderer`；日志、截图与报告在 `.artifacts/tests`；夹具在 `.artifacts/fixtures`；开发数据在 `.artifacts/data`；当前 shell 的 TEMP/TMP 指向 `.artifacts/tmp`，承接测试脚本的 mkdtemp 临时夹具；下载缓存在 `.artifacts/cache`；待发布安装包在 `.artifacts/release/v版本`。这些均不上传源码。

```powershell
npm run check        # 类型、lint、单元/集成、构建、Electron端到端
npm run dist:win     # 需要发行或改动打包/原生依赖时运行
npm run test:fixture
npm run test:visual  # 录屏需先 npx playwright install ffmpeg
npm run test:realtime
node scripts/draw-performance.mjs
node scripts/collection-performance.mjs
```

视觉与长时性能按本次修改范围执行，不为纯文档修改机械重复长测。GitHub Windows CI 在独立机器 npm ci 并执行 npm run check；不能将本机通过当作云端已通过。

验证打包程序时，先把候选安装到开发工作树 `.artifacts/install`，设置 `STUDY_SMOKE_EXE` 指向候选程序，再运行 `npm run test:installed`。该脚本默认创建独立临时 userData，也可用 `STUDY_SMOKE_DATA` 指定 `.artifacts/data/installed`。迁移测试用 `STUDY_UPGRADE_EXE` 指向隔离的旧版安装；运行 upgrade-prepare、覆盖候选版、运行 upgrade-check。先检查脚本实际环境变量和数据位置，不在正式安装或真实数据上试验。

不要提交 node_modules、SQLite、.studybackup、凭据、本机运行日志、临时调试内容或安装包。保留相关测试、构建配置、正式离线素材、许可证与必要接手文档。发布前自审 staged 清单，不能只依赖 .gitignore。

## 中文功能提交、PR 和合并

功能实现、必要测试和自审全部完成后才提交。每个完整功能通常一个中文提交；CI 修复也要整组完成并复验，不能逐次调试提交。尚未分享且无人依赖的本功能提交可 amend，共享提交不重写。

```powershell
# 在开发工作树，核对具体文件后逐项暂存。
git diff
git status --short
git add <本功能相关文件>
git diff --cached --check
git diff --cached --stat
git commit -m '新增：课程资料支持跨课程移动并保留文件副本'
git push -u origin feat/course-bookshelf
# PR 标题、说明、验证和最终 squash 提交都使用中文。
gh pr create --base main --title '新增：课程资料跨课程移动' --body-file .artifacts/pr.md
```

等待当前提交 CI 通过，核对 PR 差异、最新 main 与用户要求。采用 squash 合并，明确设置中文合并标题和正文，不让默认英文或 PR 编号成为唯一描述。GitHub 合并后回主目录 pull --ff-only 并核对远端 SHA。功能分支提交是 GitHub 验证和合并的前提；主目录同步后不额外造重复提交。

清理前必须确认 PR 已合并、完整功能在 main、CI 通过、需要的 Release 已公开且资产 hash 正确、开发工作区没有未提交或未上传内容。关闭测试程序，核对固定开发路径，再删除已确认可再生成的 node_modules 与 .artifacts，移除 worktree。不能用未经核对的 `git clean -fdx` 或强制删除忽略文件来掩盖未交付数据。

```powershell
Set-Location $main
git pull --ff-only
git status --short --branch
git rev-parse HEAD origin/main
# 核对并清除 dev 中已确认可再生成的输出后：
git worktree remove $dev
# squash 后原功能分支不一定是 main 的祖先，branch -d 可能拒绝。
# 只有 PR 已合并、无独有未交付内容的证据齐全，才可改用 branch -D。
git branch -d feat/course-bookshelf
git push origin --delete feat/course-bookshelf
New-Item -ItemType Directory -Force $dev
```

任务失败或未完成时保留唯一工作树与分支，明确未交付状态，不清空，不另建工作目录。现有 local/history 仅保留首次公开前的本地旧历史，不推送；它不是活动功能分支。

## 正式版本发行

纯文档变更不升级安装包。需要新版本时，在开发工作树统一更新版本与必要文档，构建完整 NSIS、完成候选安装和相关迁移检查、生成 SHA256SUMS.txt。先把功能验收并合并，再对确定的已合并提交打新标签；不移动旧标签、不覆盖历史发行。

把 Setup.exe、SHA256SUMS.txt 与中文发行说明上传 GitHub Releases；安装包不进源码。核对公开状态、GitHub 资产摘要与本地 SHA-256一致，才更新唯一正式程序。当前安装包未签名。安装与卸载默认保留真实学习数据，仍需用户定期导出备份。

Electron 与 better-sqlite3 按锁文件版本维护，npmRebuild:false 避免多余重建，electronDist 使用已安装 Electron；首次 NSIS 工具下载需要联网。collection-assets.mjs 直接复用已在 public 的三个 Kenney 模型；重新生成所需原件只下载至开发目录 `.artifacts/cache/assets/nature`，保留 public/assets/Collection/sources.json 来源与许可证。

## 出错时以 GitHub 为准恢复

已交付代码由 GitHub main、PR、提交和版本标签恢复；安装包由 Releases 恢复。可以在唯一开发工作树用 git show、git diff 或检出某个标签定位问题，不新增临时克隆和测试目录。

主目录异常时先保存并核对任何未提交内容，fetch 远端并比较差异，再恢复到明确的 origin/main；禁止不看差异就 reset --hard。若整个源码丢失，重新克隆 GitHub 到同一个固定主目录，再按约束重建唯一开发工作树。未提交草稿无法从 GitHub 恢复；用户学习库只靠自己的 .studybackup 恢复，不能上传公共仓库。

历史需求在 design/requirements.md，仅作参考；当前约束与 README、实时源码、版本化验收证据优先。
