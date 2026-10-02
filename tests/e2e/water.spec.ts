import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("daylight water spans the sidebar, survives navigation and freezes on pause", async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== "ELECTRON_RUN_AS_NODE") env[k] = v;
  env.STUDY_DATA_DIR = await mkdtemp(join(tmpdir(), "study-water-"));
  const app = await electron.launch({
    executablePath: process.env.STUDY_E2E_EXE,
    args: process.env.STUDY_E2E_EXE ? [] : ["."],
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "开始学习" })).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.tankMetrics?.textureReady))
      .toBe(true);
    const bounds = await page.getByTestId("app-water").boundingBox();
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    expect(bounds!.x).toBe(0);
    expect(bounds!.y).toBe(0);
    // Chromium reports fractional CSS bounds at Windows display scaling.
    expect(Math.abs(bounds!.width - size.w)).toBeLessThan(1);
    expect(Math.abs(bounds!.height - size.h)).toBeLessThan(1);
    await page.getByLabel("本次目标分钟").fill("0.2");
    await page.getByRole("button", { name: "开始学习" }).click();
    await expect
      .poll(() => page.evaluate(() => window.tankMetrics?.progress ?? 0), {
        timeout: 15000,
      })
      .toBeGreaterThan(0.4);
    const m = await page.evaluate(() => window.tankMetrics!);
    expect(m.dropEvents).toBeGreaterThan(1);
    expect(m.dropEvents).toBeLessThan(30);
    expect(m.rainCount).toBeLessThanOrEqual(6);
    await page.getByRole("button", { name: "Ⅱ 暂停学习" }).click();
    await expect
      .poll(() => page.evaluate(() => window.tankMetrics?.rainCount))
      .toBe(0);
    const frozen = await page.evaluate(() => ({
      time: window.tankMetrics!.visualTime,
      level: window.tankMetrics!.progress,
    }));
    await page.evaluate(() => {
      document
        .querySelector(".app-water canvas")!
        .setAttribute("data-persistent", "yes");
    });
    await page.getByRole("button", { name: "学习资料", exact: true }).click();
    await expect(
      page.locator('.app-water canvas[data-persistent="yes"]'),
    ).toHaveCount(1);
    await expect(page.getByLabel("搜索全部课程和资料")).toBeVisible();
    await page.waitForTimeout(600);
    expect(
      await page.evaluate(() => ({
        time: window.tankMetrics!.visualTime,
        level: window.tankMetrics!.progress,
      })),
    ).toEqual(frozen);
    await mkdir(".artifacts/tests", { recursive: true });
    await page.screenshot({
      path: resolve(".artifacts/tests/library-water.png"),
    });
    // Capture pixels from the real Electron window, including the navigation rail.
    const brightness = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].capturePage();
      const { width, height } = image.getSize(),
        pixels = image.toBitmap();
      const sample = (x: number, y: number) => {
        const i = (Math.floor(y * height) * width + Math.floor(x * width)) * 4;
        return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      };
      return {
        upper: sample(0.02, 0.15),
        lower: sample(0.02, 0.7),
        right: sample(0.96, 0.7),
      };
    });
    expect(brightness.upper).toBeGreaterThan(230);
    expect(brightness.lower).toBeGreaterThan(205);
    expect(brightness.right).toBeGreaterThan(205);
    expect(brightness.upper - brightness.lower).toBeGreaterThan(5);
    await page.getByRole("button", { name: "▷ 继续学习" }).click();
    await expect
      .poll(() => page.evaluate(() => window.tankMetrics?.progress ?? 0))
      .toBeGreaterThan(frozen.level);
    await page.getByRole("button", { name: "结束并保存" }).click();
  } finally {
    await app.close();
  }
});
