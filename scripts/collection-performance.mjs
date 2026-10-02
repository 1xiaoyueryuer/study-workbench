import { _electron as electron } from "@playwright/test";
import { readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
const fixture = JSON.parse(
  await readFile(".artifacts/tests/visual-fixture.json", "utf8"),
);
const root = resolve(".artifacts/cache/performance-v04-" + Date.now());
await cp(fixture.root, root, { recursive: true });
const env = { ...process.env, STUDY_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    ".",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "开始学习" }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1366, 768);
    w.show();
  });
  await page.getByRole("button", { name: "学习资料", exact: true }).click();
  await page.screenshot({
    path: resolve(".artifacts/tests/bookshelf-filled.png"),
  });
  await page.getByRole("button", { name: "收藏品", exact: true }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: resolve(".artifacts/tests/collection-filled.png"),
  });
  await page.getByRole("button", { name: /仓库 \d+\/50/ }).click();
  await page.screenshot({
    path: resolve(".artifacts/tests/warehouse-filled.png"),
  });
  await page.getByRole("button", { name: "返回收藏品" }).click();
  await page.getByRole("button", { name: "学习首页" }).click();
  await page.getByLabel("本次目标分钟").fill("5");
  await page.getByRole("button", { name: "开始学习" }).click();
  await page.getByRole("button", { name: "收藏品", exact: true }).click();
  await page.evaluate(() => {
    window.__perf = {
      frames: [],
      last: performance.now(),
      start: performance.now(),
    };
    const loop = (t) => {
      if (t - window.__perf.start < 300000) {
        window.__perf.frames.push(t - window.__perf.last);
        window.__perf.last = t;
        window.requestAnimationFrame(loop);
      }
    };
    window.requestAnimationFrame(loop);
  });
  const gpu = await app.evaluate(({ app }) => app.getGPUInfo("complete"));
  const samples = [];
  await mkdir(".artifacts/tests", { recursive: true });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 30000));
    const metrics = await page.evaluate(() => ({
      frames: window.tankMetrics.frames,
      drops: window.tankMetrics.dropEvents,
      drawCalls: window.tankMetrics.drawCalls,
      triangles: window.tankMetrics.triangles,
      webglCanvases: document.querySelectorAll("canvas").length,
      visible: document.visibilityState,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    }));
    const processes = await app.evaluate(({ app }) => app.getAppMetrics());
    samples.push({ seconds: (i + 1) * 30, metrics, processes });
    await writeFile(
      ".artifacts/tests/performance-progress.json",
      JSON.stringify(
        {
          samples,
          gpu,
          os: { release: os.release(), cpu: os.cpus()[0]?.model },
          note: "Normal clock; test ownership fixture; native occlusion disabled to keep a visible rendering workload.",
        },
        null,
        2,
      ),
    );
    if (i === 9) {
      const frames = await page.evaluate(() => window.__perf.frames);
      await writeFile(
        ".artifacts/tests/performance-5min.json",
        JSON.stringify(
          {
            samples,
            frames,
            gpu,
            os: { release: os.release(), cpu: os.cpus()[0]?.model },
          },
          null,
          2,
        ),
      );
      await page.screenshot({
        path: resolve(".artifacts/tests/collection-water.png"),
      });
    }
    console.log(
      JSON.stringify({
        seconds: (i + 1) * 30,
        drops: metrics.drops,
        canvases: metrics.webglCanvases,
      }),
    );
  }
  await writeFile(
    ".artifacts/tests/performance-60min.json",
    JSON.stringify({ samples, gpu }, null, 2),
  );
} finally {
  await app.close();
}
