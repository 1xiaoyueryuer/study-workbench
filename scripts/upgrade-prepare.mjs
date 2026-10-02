import { _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = await mkdtemp(join(tmpdir(), "study-upgrade-v03-"));
const env = { ...process.env, STUDY_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: resolve(
    process.env.STUDY_UPGRADE_EXE ??
      ".artifacts/cache/upgrade-installed/积水书房.exe",
  ),
  args: [],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "开始学习" }).waitFor();
  const invoke = (method, payload = {}) =>
    page.evaluate(
      async ({ method, payload }) => {
        const s = await window.workbench.getSnapshot({
          datasetId: "",
          operationId: crypto.randomUUID(),
          payload: {},
        });
        const r = await window.workbench[method]({
          datasetId: s.value.datasetId,
          operationId: crypto.randomUUID(),
          payload,
        });
        if (!r.ok) throw Error(r.error.message);
        return r.value;
      },
      { method, payload },
    );
  const session = await invoke("startStudy", { targetMs: 3000 });
  await new Promise((r) => setTimeout(r, 3200));
  await invoke("endStudy", { sessionId: session.id });
  const reward = await invoke("saveReward", {
    name: "旧版一秒奖励",
    priceSec: 1,
  });
  const intent = await invoke("prepareRedemption", { rewardId: reward.id });
  const receipt = await invoke("confirmRedemption", { intentId: intent.id });
  const category = await invoke("saveCategory", { name: "旧版数学" });
  const file = join(root, "原始笔记.txt");
  await writeFile(file, "旧版导入内容");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await invoke("chooseAndImportFiles", { categoryId: category.id });
  await invoke("chooseAndImportFiles", { categoryId: null });
  const snapshot = await invoke("getSnapshot"),
    resources = await invoke("listResources", { offset: 0 });
  await mkdir(".artifacts/tests", { recursive: true });
  await writeFile(
    ".artifacts/tests/upgrade-before.json",
    JSON.stringify(
      {
        root,
        snapshot,
        receipt,
        category,
        resources,
        version: await app.evaluate(({ app }) => app.getVersion()),
      },
      null,
      2,
    ),
  );
  console.log("Old installed baseline ready");
} finally {
  await app.close();
}
