import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("collection UI places, retrieves and sells persisted ownership, supports low motion and lost context", async () => {
  const fixture = JSON.parse(
    await readFile(".artifacts/tests/visual-fixture.json", "utf8"),
  );
  const root = await mkdtemp(join(tmpdir(), "study-collection-ui-"));
  await cp(fixture.root, root, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
    STUDY_DATA_DIR: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "开始学习" })).toBeEnabled();
    await page.getByRole("button", { name: "收藏品", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.collectionMetrics?.frames ?? 0))
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: /仓库 6\/50/ }).click();
    await page.getByRole("button", { name: "听雨白石，普通" }).click();
    await page.getByRole("button", { name: "放入展示" }).click();
    await page.getByRole("button", { name: "1 号缸 · 交换" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".inventory-slot.occupied")).toHaveCount(6);
    await page.getByRole("button", { name: "返回收藏品" }).click();
    await page.getByRole("button", { name: "展示缸 1 听雨白石" }).click();
    await page.getByRole("button", { name: "取回仓库" }).click();
    await page.getByRole("button", { name: /仓库 7\/50/ }).click();
    await page.getByRole("button", { name: "听雨白石，普通" }).click();
    await page.getByRole("button", { name: "出售", exact: true }).click();
    await page.getByRole("button", { name: "确认出售" }).click();
    await expect(page.locator(".inventory-slot.occupied")).toHaveCount(6);
    await page.getByRole("button", { name: "奖励商店", exact: true }).click();
    await expect(page.locator(".shop .page-heading")).toContainText("1 积分");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("低动态模式").check();
    await page.getByRole("button", { name: "保存外观" }).click();
    await page.getByRole("button", { name: "收藏品", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.collectionMetrics?.frames ?? 0))
      .toBeGreaterThan(0);
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => window.collectionMetrics!.frames);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.collectionMetrics!.frames)).toBe(
      before,
    );
    await page.evaluate(() =>
      document
        .querySelector<HTMLCanvasElement>(".collection-scene canvas")!
        .getContext("webgl2")!
        .getExtension("WEBGL_lose_context")!
        .loseContext(),
    );
    await expect(page.getByText("展示兼容模式，物品仍保留")).toBeVisible();
    await page.getByRole("button", { name: /仓库 6\/50/ }).click();
    await expect(page.locator(".inventory-slot.occupied")).toHaveCount(6);
    await page.getByRole("button", { name: "学习首页" }).click();
    await page.evaluate(() => {
      const original = window.fetch;
      (
        window as Window & { restoreModelFetch?: () => void }
      ).restoreModelFetch = () => {
        window.fetch = original;
      };
      window.fetch = (input, init) =>
        String(input instanceof Request ? input.url : input).endsWith(".glb")
          ? Promise.reject(new Error("simulated missing model"))
          : original(input, init);
    });
    await page.getByRole("button", { name: "收藏品", exact: true }).click();
    await expect(
      page.getByText("部分模型加载失败，已用替代物显示"),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as Window & { restoreModelFetch?: () => void }
      ).restoreModelFetch?.(),
    );
    await page.getByRole("button", { name: "重试展示" }).click();
    await expect(
      page.getByText("部分模型加载失败，已用替代物显示"),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});
