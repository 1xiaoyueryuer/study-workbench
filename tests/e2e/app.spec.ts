import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
test("offline Electron flow: real timing, rewards, settings and renderer reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-e2e-"));
  const app = await electron.launch({
    args: ["."],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key !== "ELECTRON_RUN_AS_NODE",
        ),
      ),
      STUDY_DATA_DIR: root,
    },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("THREE."))
      errors.push(m.text());
  });
  await expect(page.getByRole("button", { name: "开始学习" })).toBeEnabled();
  await page.getByLabel("本次目标分钟").fill("0.05");
  await page.getByRole("button", { name: "开始学习" }).click();
  await expect(page.getByRole("button", { name: "Ⅱ 暂停学习" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.tankMetrics?.rainCount ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.getByTestId("hero-time").innerText())
    .not.toBe("00:00:00");
  await page.reload();
  await expect(page.getByRole("button", { name: "结束并保存" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.tankMetrics?.dropEvents ?? 0))
    .toBeGreaterThan(0);
  await mkdir(".artifacts/tests", { recursive: true });
  await page.screenshot({ path: resolve(".artifacts/tests/learning.png") });
  await page.getByRole("button", { name: "Ⅱ 暂停学习" }).click();
  await expect
    .poll(() => page.evaluate(() => window.tankMetrics?.rainCount ?? 0))
    .toBe(0);
  await page.screenshot({ path: resolve(".artifacts/tests/paused.png") });
  await page.getByRole("button", { name: "结束并保存" }).click();
  await page.getByRole("button", { name: "奖励商店" }).click();
  await page.getByLabel("奖励名称").fill("喝杯茶");
  await page.getByLabel("积分价格", { exact: true }).fill("1");
  await page.getByRole("button", { name: "添加奖励" }).click();
  await page.getByRole("button", { name: "兑换奖励" }).click();
  await page.getByRole("button", { name: "确认兑换", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("积分不足");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: resolve(".artifacts/tests/rewards.png") });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "杏茶手帖" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tea");
  await page.getByRole("button", { name: "学习首页" }).click();
  await page.screenshot({ path: resolve(".artifacts/tests/tea.png") });
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() =>
      Boolean(document.createElement("canvas").getContext("webgl2")),
    ),
  ).toBe(true);
  await app.close();
  const reopened = await electron.launch({
    args: ["."],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key !== "ELECTRON_RUN_AS_NODE",
        ),
      ),
      STUDY_DATA_DIR: root,
    },
  });
  const next = await reopened.firstWindow();
  await expect(next.locator("html")).toHaveAttribute("data-theme", "tea");
  await next.getByRole("button", { name: "奖励商店" }).click();
  await expect(
    next.getByRole("heading", { name: "喝杯茶", exact: true }),
  ).toBeVisible();
  await expect(next.locator(".receipts")).toContainText("兑换记录");
  await reopened.close();
});

test("power lifecycle hooks pause and require manual resume; minimize keeps the session", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-power-"));
  const app = await electron.launch({
    args: ["."],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key !== "ELECTRON_RUN_AS_NODE",
        ),
      ),
      STUDY_DATA_DIR: root,
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "开始学习" })).toBeEnabled();
    await page.getByRole("button", { name: "开始学习" }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await new Promise((r) => setTimeout(r, 1200));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    await expect(page.getByTestId("hero-time")).not.toHaveText("00:00:00");
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit("lock-screen"));
    await expect(
      page.getByRole("button", { name: "▷ 继续学习" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "▷ 继续学习" }).click();
    await expect(page.getByRole("alert")).toContainText("解锁");
    await app.evaluate(({ powerMonitor }) =>
      powerMonitor.emit("unlock-screen"),
    );
    await expect(
      page.getByRole("button", { name: "▷ 继续学习" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "▷ 继续学习" }).click();
    await expect(
      page.getByRole("button", { name: "Ⅱ 暂停学习" }),
    ).toBeVisible();
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
    await expect(
      page.getByRole("button", { name: "▷ 继续学习" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "结束并保存" }).click();
  } finally {
    await app.close();
  }
});
