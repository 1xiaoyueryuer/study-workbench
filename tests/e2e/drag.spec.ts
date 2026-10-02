import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("native disk File objects cross sandbox preload; multi-file drag, duplicate, unsupported and synthetic rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-drag-"));
  const file1 = join(root, "中文笔记.txt"),
    file2 = join(root, "中文笔记副本.txt"),
    bad = join(root, "not-allowed.exe");
  await writeFile(file1, "磁盘真实内容");
  await writeFile(file2, "磁盘真实内容");
  await writeFile(bad, "not executable");
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
    STUDY_DATA_DIR: join(root, "data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "开始学习" })).toBeEnabled();
    await page.getByRole("button", { name: "学习资料", exact: true }).click();
    await page.getByRole("button", { name: "未归档" }).click();
    const bounds = (await page.locator(".course-content").boundingBox())!;
    const client = await page.context().newCDPSession(page);
    const data = {
      items: [],
      files: [file1, file2, bad],
      dragOperationsMask: 1,
    };
    for (const type of ["dragEnter", "dragOver", "drop"] as const)
      await client.send("Input.dispatchDragEvent", {
        type,
        x: bounds.x + 100,
        y: bounds.y + 100,
        data,
      });
    await expect(page.locator(".course-file")).toHaveCount(1);
    await expect(page.locator(".import-summary")).toContainText("已在课程中");
    await expect(page.locator(".import-summary")).toContainText("不支持此格式");
    const rejected = await page.evaluate(async () => {
      const snapshot = await window.workbench.getSnapshot({
        datasetId: "",
        operationId: crypto.randomUUID(),
        payload: {},
      });
      if (!snapshot.ok) throw Error("snapshot");
      const courses = await window.workbench.listCourses({
        datasetId: snapshot.value.datasetId,
        operationId: crypto.randomUUID(),
        payload: {},
      });
      if (!courses.ok) throw Error("courses");
      return window.workbench.importDroppedFiles(
        [new File(["fake"], "fake.txt")],
        courses.value[0].id,
        crypto.randomUUID(),
        snapshot.value.datasetId,
      );
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    await mkdir(".artifacts/tests", { recursive: true });
    await page.screenshot({ path: ".artifacts/tests/disk-drag.png" });
  } finally {
    await app.close();
  }
});
