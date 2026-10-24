import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const envFor = (root: string) => {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
    STUDY_DATA_DIR: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
test("native focus window is authoritative, restores bounds and preserves real timer across ten checkpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-focus-")),
    app = await electron.launch({ args: ["."], env: envFor(root) });
  try {
    const p = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSkipTaskbar(true),
    );
    await p.getByRole("button", { name: "开始学习" }).waitFor();
    const state = () =>
      app.evaluate(({ BrowserWindow }) => ({
        fullscreen: BrowserWindow.getAllWindows()[0].isFullScreen(),
        bounds: BrowserWindow.getAllWindows()[0].getBounds(),
      }));
    const before = await state();
    await p.getByRole("button", { name: "全屏专注" }).click();
    await expect.poll(async () => (await state()).fullscreen).toBe(true);
    await expect(p.locator(".sidebar")).toBeHidden();
    await p.getByRole("button", { name: "开始学习" }).click();
    // Native full-screen is confirmed above; hide the owned test window during
    // the long timer sample to avoid stealing the desktop or external clicks.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
    await p.waitForTimeout(500);
    const samples = [];
    for (let i = 0; i < 260; i++) {
      await p.waitForTimeout(250);
      expect((await state()).fullscreen).toBe(true);
      samples.push(
        await p.evaluate(async () => {
          const r = await window.workbench.getSnapshot({
            datasetId: "",
            operationId: crypto.randomUUID(),
            payload: {},
          });
          return {
            snapshot: r.ok ? r.value : null,
            rects: [
              ...document.querySelectorAll(
                ".rain-stats>div,.rain-stats small,.rain-save",
              ),
            ].map((e) => ({
              text: e.textContent,
              rect: e.getBoundingClientRect().toJSON(),
            })),
          };
        }),
      );
    }
    await mkdir(".artifacts/tests/focus", { recursive: true });
    await writeFile(
      ".artifacts/tests/focus/realtime-all-samples.json",
      JSON.stringify(samples, null, 2),
    );
    const checkpoints = new Set(
      samples.map((s) => s.snapshot?.lastCheckpointAt).filter(Boolean),
    );
    expect(checkpoints.size).toBeGreaterThanOrEqual(10);
    for (let j = 0; j < 7; j++) {
      const values = samples.map((s) => s.rects[j].rect.y);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
    expect(
      samples.every(
        (s) =>
          s.rects.filter((r) => r.text === "实时估算 · 每约5秒保存").length ===
          3,
      ),
    ).toBe(true);
    const id = samples.at(-1)!.snapshot!.session!.id;
    await p.reload();
    await expect(p.getByRole("button", { name: "退出全屏专注" })).toBeVisible();
    await p.keyboard.press("Escape");
    await expect.poll(async () => (await state()).fullscreen).toBe(false);
    expect((await state()).bounds).toEqual(before.bounds);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
    await p.keyboard.press("F11");
    await expect.poll(async () => (await state()).fullscreen).toBe(true);
    await p.keyboard.press("F11");
    await expect.poll(async () => (await state()).fullscreen).toBe(false);
    await p.getByRole("button", { name: "Ⅱ 暂停学习" }).click();
    await expect(p.locator(".rain-stats small")).toHaveText([
      "已保存",
      "已保存",
      "已保存",
    ]);
    await p.getByRole("button", { name: "▷ 继续学习" }).click();
    await p.getByRole("button", { name: "结束并保存" }).click();
    await expect(p.getByRole("button", { name: "开始学习" })).toBeVisible();
    await mkdir(".artifacts/tests/focus", { recursive: true });
    await writeFile(
      ".artifacts/tests/focus/realtime-rects.json",
      JSON.stringify(
        { checkpoints: checkpoints.size, sessionId: id, samples },
        null,
        2,
      ),
    );
    await p.screenshot({
      path: resolve(".artifacts/tests/focus/focus-ended.png"),
    });
  } finally {
    await app.close();
  }
});
