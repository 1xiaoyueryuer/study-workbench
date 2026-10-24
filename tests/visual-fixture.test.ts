import { test } from "vitest";
import { Datasets } from "../src/main/files";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
test("create isolated visual and performance fixture through current store", async () => {
  const root = resolve(".artifacts/fixtures/visual"),
    d = new Datasets(root);
  if (
    !root.startsWith(resolve(".artifacts/fixtures") + "/") &&
    !root.startsWith(resolve(".artifacts/fixtures") + "\\")
  )
    throw new Error("Invalid fixture path");
  await rm(root, { recursive: true, force: true });
  await d.init();
  const cmd = (m: Parameters<typeof d.store.command>[0], p: unknown) =>
    d.store.command(m, {
      datasetId: d.store.datasetId,
      operationId: randomUUID(),
      payload: p,
    });
  for (const name of [
    "高等数学",
    "线性代数",
    "概率论与数理统计",
    "英语",
    "政治",
    "计算机专业基础",
  ])
    cmd("createCourse", { name });
  cmd("saveReward", { name: "一杯桂花拿铁", priceMs: 1800000 });
  d.store.audit();
  d.store.close();
  await mkdir(".artifacts/tests", { recursive: true });
  await writeFile(
    ".artifacts/tests/visual-fixture.json",
    JSON.stringify(
      {
        root,
        database: join(d.dir, "study.sqlite"),
        note: "Isolated test-only fixture, no production reward injection interface.",
      },
      null,
      2,
    ),
  );
});
