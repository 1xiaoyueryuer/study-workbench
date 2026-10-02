import { expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = await mkdtemp(join(tmpdir(), "study-visual-"));
const env = { ...process.env, STUDY_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(".artifacts/tests/video", { recursive: true });
const app = await electron.launch({
  args: ["."],
  env,
  recordVideo: {
    dir: resolve(".artifacts/tests/video"),
    size: { width: 1280, height: 800 },
  },
});
const page = await app.firstWindow();
await page.getByRole("button", { name: "开始学习" }).waitFor();
await expect
  .poll(() => page.evaluate(() => window.tankMetrics?.textureReady))
  .toBe(true);
await page.screenshot({ path: resolve(".artifacts/tests/idle.png") });
await page.getByLabel("本次目标分钟").fill("0.167");
await page.getByRole("button", { name: "开始学习" }).click();
await new Promise((r) => setTimeout(r, 4500));
await page.screenshot({ path: resolve(".artifacts/tests/half.png") });
await new Promise((r) => setTimeout(r, 6500));
await page.screenshot({ path: resolve(".artifacts/tests/overflow.png") });
await page.mouse.move(400, 470);
await new Promise((r) => setTimeout(r, 2000));
await page.mouse.move(1100, 490);
await new Promise((r) => setTimeout(r, 2000));
await page.getByRole("button", { name: "Ⅱ 暂停学习" }).click();
await page.screenshot({ path: resolve(".artifacts/tests/paused.png") });
await page.getByRole("button", { name: "结束并保存" }).click();
await page.screenshot({ path: resolve(".artifacts/tests/ended.png") });
await page.getByRole("button", { name: "设置", exact: true }).click();
await page.getByRole("button", { name: "湖蓝晨光" }).click();
await page.getByRole("button", { name: "学习首页" }).click();
await page.screenshot({ path: resolve(".artifacts/tests/lake.png") });
await page.getByRole("button", { name: "设置", exact: true }).click();
await page.getByLabel("低动态模式").check();
await page.getByRole("button", { name: "保存外观" }).click();
await page.getByRole("button", { name: "学习首页" }).click();
await page.screenshot({ path: resolve(".artifacts/tests/low-motion.png") });
await page.evaluate(() =>
  document
    .querySelector("canvas")
    .getContext("webgl2")
    .getExtension("WEBGL_lose_context")
    .loseContext(),
);
await page.getByText("当前处于兼容模式").waitFor();
await page.screenshot({ path: resolve(".artifacts/tests/compatibility.png") });
await page.getByRole("button", { name: "开始学习" }).click();
await new Promise((r) => setTimeout(r, 1100));
await page.getByRole("button", { name: "结束并保存" }).click();
const video = page.video();
await app.close();
if (video) await video.saveAs(resolve(".artifacts/tests/water-demo.webm"));
const layout = [];
const fixture = JSON.parse(
  await readFile(".artifacts/tests/visual-fixture.json", "utf8"),
);
for (const scale of [1.25, 1.5]) {
  const testEnv = {
    ...env,
    STUDY_DATA_DIR: await mkdtemp(join(tmpdir(), "study-layout-")),
  };
  await cp(fixture.root, testEnv.STUDY_DATA_DIR, { recursive: true });
  const instance = await electron.launch({
    args: [".", `--force-device-scale-factor=${scale}`],
    env: testEnv,
  });
  const p = await instance.firstWindow();
  await p.getByRole("button", { name: "开始学习" }).waitFor();
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ]) {
    await instance.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    await p.screenshot({
      path: resolve(`.artifacts/tests/layout-${width}-${scale}.png`),
    });
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    layout.push({ width, height, scale, horizontalOverflow: overflow });
    if (overflow) throw new Error("Horizontal layout overflow");
    for (const [name, slug] of [
      ["学习资料", "books"],
      ["收藏品", "collection"],
    ]) {
      await p.getByRole("button", { name, exact: true }).click();
      await p.waitForTimeout(800);
      await p.screenshot({
        path: resolve(`.artifacts/tests/layout-${slug}-${width}-${scale}.png`),
      });
      const over = await p.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      layout.push({
        page: slug,
        width,
        height,
        scale,
        horizontalOverflow: over,
      });
      if (over) throw new Error("Page layout overflow: " + slug);
    }
    await p.getByRole("button", { name: /仓库 \d+\/50/ }).click();
    await p.screenshot({
      path: resolve(`.artifacts/tests/layout-warehouse-${width}-${scale}.png`),
    });
    await p.getByRole("button", { name: "学习首页" }).click();
  }
  await instance.close();
}
await writeFile(
  ".artifacts/tests/layout.json",
  JSON.stringify(layout, null, 2),
);
