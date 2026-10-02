import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
test("white bookshelf, course link, global search and preserving deletion", async () => {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
    STUDY_DATA_DIR: await mkdtemp(join(tmpdir(), "study-library-")),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "开始学习" })).toBeEnabled();
    await page.getByRole("button", { name: "学习资料", exact: true }).click();
    await page.getByRole("button", { name: "添加课程", exact: true }).click();
    await page.getByLabel("课程名", { exact: true }).fill("高等数学与线性代数");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.getByRole("button", { name: "高等数学与线性代数" }).click();
    await page.getByText("更多", { exact: true }).click();
    await page.getByRole("button", { name: "添加网页链接" }).click();
    await page.getByLabel("网页标题").fill("高数笔记");
    await page.getByLabel("网址", { exact: true }).fill("https://example.com");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.locator(".course-file")).toHaveCount(1);
    await page.getByRole("button", { name: "返回书架" }).click();
    await mkdir(".artifacts/tests", { recursive: true });
    await page.screenshot({ path: resolve(".artifacts/tests/bookshelf.png") });
    await page.getByLabel("搜索全部课程和资料").fill("高数笔记");
    await expect(page.locator(".course-file")).toHaveCount(1);
    await page.getByLabel("搜索全部课程和资料").fill("");
    await page.getByRole("button", { name: "高等数学与线性代数" }).click();
    await page.getByText("更多", { exact: true }).click();
    await page.getByRole("button", { name: "删除课程", exact: true }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.getByRole("button", { name: "未归档" }).click();
    await expect(page.locator(".course-file")).toHaveCount(1);
    await page.getByRole("button", { name: "收藏品", exact: true }).click();
    await expect(page.locator(".collection-scene canvas")).toHaveCount(1);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: resolve(".artifacts/tests/collection-empty.png"),
    });
    await page.getByRole("button", { name: "仓库 0/50" }).click();
    await expect(page.locator(".inventory-slot")).toHaveCount(50);
    await page.screenshot({
      path: resolve(".artifacts/tests/warehouse-empty.png"),
    });
  } finally {
    await app.close();
  }
});
