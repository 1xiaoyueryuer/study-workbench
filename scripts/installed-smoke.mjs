import { validationArgs, parkWindow } from "./validation-window.mjs";
/* Exercises the packaged executable through its normal preload API; no injected clock. */
import { _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root =
  process.env.STUDY_SMOKE_DATA ??
  (await mkdtemp(join(tmpdir(), "study-installed-")));
const exe = resolve(
  process.env.STUDY_SMOKE_EXE ??
    join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "StudyWorkbench",
      "积水书房.exe",
    ),
);
const env = {
  ...process.env,
  STUDY_DATA_DIR: root,
  STUDY_SMOKE_OUTPUT: resolve(".artifacts/tests/installed-native.json"),
  PATH: process.env.SystemRoot + "\\System32",
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({ executablePath: exe, args: [...validationArgs], env });
await mkdir(".artifacts/tests", { recursive: true });
let app = await launch();
let page = await app.firstWindow();
await parkWindow(app);
await page.context().setOffline(true);
await page.getByRole("button", { name: "开始学习" }).waitFor();
const invoke = async (method, payload = {}) =>
  page.evaluate(
    async ({ method, payload }) => {
      const s = await window.workbench.getSnapshot({
        datasetId: "",
        operationId: crypto.randomUUID(),
        payload: {},
      });
      let snapshot;
      if (s.ok) snapshot = s.value;
      else
        snapshot = await new Promise((resolve) => {
          const off = window.workbench.subscribeSnapshot((value) => {
            off();
            resolve(value);
          });
        });
      const result = await window.workbench[method]({
        datasetId: snapshot.datasetId,
        operationId: crypto.randomUUID(),
        payload,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    { method, payload },
  );
const windowEvidence = [];
const native = () =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return {
      fullscreen: w.isFullScreen(),
      maximized: w.isMaximized(),
      minimized: w.isMinimized(),
      bounds: w.getBounds(),
      normal: w.getNormalBounds(),
    };
  });
const idleBefore = await invoke("getSnapshot");
const ordinary = await native();
for (let i = 0; i < 2; i++) {
  await invoke("setFocusFullscreen", { enabled: true });
  assert.equal((await native()).fullscreen, true);
  await invoke("setFocusFullscreen", { enabled: true });
  await page.reload();
  await page.getByRole("button", { name: "退出全屏专注" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "⛶ 全屏专注" }).waitFor();
  assert.equal((await native()).fullscreen, false);
  assert.deepEqual((await native()).bounds, ordinary.bounds);
  windowEvidence.push(await native());
}
await page.keyboard.press("F11");
await page.getByRole("button", { name: "退出全屏专注" }).waitFor();
await page.screenshot({
  path: resolve(".artifacts/tests/installed-focus.png"),
});
await page.keyboard.press("F11");
await page.getByRole("button", { name: "⛶ 全屏专注" }).waitFor();
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].maximize(),
);
await page.waitForTimeout(300);
assert.equal((await native()).maximized, true);
await invoke("setFocusFullscreen", { enabled: true });
await invoke("setFocusFullscreen", { enabled: false });
assert.equal((await native()).maximized, true);
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].minimize(),
);
await page.waitForTimeout(300);
assert.equal((await native()).minimized, true);
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].restore(),
);
await page.waitForTimeout(300);
windowEvidence.push(await native());
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].unmaximize(),
);
const idleAfter = await invoke("getSnapshot");
assert.equal(idleAfter.dbRevision, idleBefore.dbRevision);
assert.equal(idleAfter.earnedMs, idleBefore.earnedMs);
const start = await invoke("startStudy", { targetMs: 60000 });
await invoke("setFocusFullscreen", { enabled: true });
assert.equal((await native()).fullscreen, true);
assert.equal((await invoke("getSnapshot")).session.id, start.id);

await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].hide(),
);
await new Promise((r) => setTimeout(r, 62000));
await invoke("setFocusFullscreen", { enabled: false });
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].showInactive(),
);
assert.equal((await invoke("getSnapshot")).session.id, start.id);
await invoke("endStudy", { sessionId: start.id });
const reward = await invoke("saveReward", {
  name: "安装态奖励",
  priceMs: 60000,
});
const intent = await invoke("prepareRedemption", { rewardId: reward.id });
const receipt = await invoke("confirmRedemption", { intentId: intent.id });
const replay = await invoke("confirmRedemption", { intentId: intent.id });
assert.equal(receipt.id, replay.id);
const file = join(root, "原始笔记.txt");
await writeFile(file, "离线导入测试：原文件可移动。");
await app.evaluate(({ dialog }, file) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
}, file);
await invoke("chooseAndImportFiles", { courseId: null });
const resources = await invoke("listResources", { offset: 0 });
assert.equal(resources.length, 1);
await writeFile(file, "原文件已改变");
await invoke("openResource", { id: resources[0].id });
const viewer = app.windows().find((p) => p !== page);
if (viewer) {
  await viewer.waitForLoadState();
  assert.match(await viewer.locator("body").innerText(), /原文件可移动/);
  await viewer.close();
}
const backup = join(root, "roundtrip.studybackup");
await app.evaluate(({ dialog }, file) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
}, backup);
await invoke("exportBackup");
await app.evaluate(({ dialog }, file) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
}, backup);
const inspected = await invoke("inspectBackup");
assert.equal(inspected.resourceCount, 1);
const before = await invoke("getSnapshot");
await invoke("restoreBackup", { token: inspected.token, confirmed: true });
const after = await invoke("getSnapshot");
assert.notEqual(after.datasetId, before.datasetId);
assert.equal(after.balanceMs, before.balanceMs);
assert.equal(after.earnedMs, before.earnedMs);
await page.screenshot({ path: resolve(".artifacts/tests/installed.png") });
await app.close();
app = await launch();
page = await app.firstWindow();
await page.context().setOffline(true);
await page.getByRole("button", { name: "开始学习" }).waitFor();
const final = await invoke("getSnapshot");
assert.equal(final.balanceMs, before.balanceMs);
const receipts = await invoke("listRedemptions", { offset: 0 });
assert.equal(receipts.length, 1);
const result = {
  passed: true,
  nativeFocus: {
    windowEvidence,
    idleRevisionUnchanged: true,
    timerPreserved: true,
  },
  packaged: await app.evaluate(({ app }) => app.isPackaged),
  root,
  offlineContext: true,
  noNodeOnPath: true,
  earnedMs: final.earnedMs,
  balanceMs: final.balanceMs,
  receiptCount: receipts.length,
  attachmentRoundtrip: true,
  backupRestore: true,
  restartPersistence: true,
  native: JSON.parse(
    await readFile(".artifacts/tests/installed-native.json", "utf8"),
  ),
};
await writeFile(
  ".artifacts/tests/installed-smoke.json",
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    passed: true,
    packaged: result.packaged,
    earnedMs: result.earnedMs,
    balanceMs: result.balanceMs,
  }),
);
await app.close();
