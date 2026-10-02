import { _electron as electron } from "@playwright/test";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const before = JSON.parse(
    await readFile(".artifacts/tests/upgrade-before.json", "utf8"),
  ),
  env = { ...process.env, STUDY_DATA_DIR: before.root };
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
  await page.context().setOffline(true);
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
  const snapshot = await invoke("getSnapshot"),
    resources = await invoke("listResources", { offset: 0 }),
    receipts = await invoke("listRedemptions", { offset: 0 }),
    courses = await invoke("listCourses");
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), "0.4.0");
  assert.equal(snapshot.earnedMs, before.snapshot.earnedMs);
  assert.equal(snapshot.balanceMs, before.snapshot.balanceMs);
  assert.equal(snapshot.todayMs, before.snapshot.todayMs);
  assert.equal(snapshot.pointsBalance, 0);
  assert.equal(snapshot.inventoryCount, 0);
  assert.equal(resources.length, 2);
  assert.equal(new Set(resources.map((r) => r.attachment_id)).size, 1);
  assert.equal(receipts[0].price_amount, 1000);
  assert.equal(receipts[0].currency, "study_ms");
  assert.ok(courses.some((c) => c.id === before.category.id));
  const pointer = JSON.parse(
      await readFile(join(before.root, "current.json"), "utf8"),
    ),
    attachments = join(before.root, "datasets", pointer.id, "attachments"),
    names = await readdir(attachments);
  assert.equal(names.length, 1);
  const sha = createHash("sha256")
    .update(await readFile(join(attachments, names[0])))
    .digest("hex");
  const backups = await readdir(join(before.root, "backups"));
  assert.ok(backups.some((n) => n.startsWith("before-upgrade-")));
  await page.getByRole("button", { name: "奖励商店", exact: true }).click();
  await page.screenshot({ path: ".artifacts/tests/upgrade-receipt.png" });
  await writeFile(
    ".artifacts/tests/upgrade.json",
    JSON.stringify(
      {
        passed: true,
        type: "installed NSIS 0.3.0 -> 0.4.0",
        before: before.snapshot,
        after: snapshot,
        courses,
        resources,
        receipts,
        attachmentSha256: sha,
        physicalAttachmentCount: names.length,
        backups,
      },
      null,
      2,
    ),
  );
  console.log(
    "Installed upgrade preserved E/T/daily/receipts and deduplicated 2 references to 1 attachment",
  );
} finally {
  await app.close();
}
