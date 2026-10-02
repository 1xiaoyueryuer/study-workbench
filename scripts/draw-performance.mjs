import { _electron as electron } from "@playwright/test";
import { readFile, writeFile, cp } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
const fixture = JSON.parse(
  await readFile(".artifacts/tests/visual-fixture.json", "utf8"),
);
const root = resolve(".artifacts/cache/draw-performance-" + Date.now());
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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1366, 768),
  );
  await page.getByLabel("本次目标分钟").fill("5");
  await page.getByRole("button", { name: "开始学习" }).click();
  await page.getByRole("button", { name: "收藏品", exact: true }).click();
  await page.waitForTimeout(2000);
  const read = () =>
    page.evaluate(() => ({
      water: window.tankMetrics,
      collection: window.collectionMetrics,
      canvases: document.querySelectorAll("canvas").length,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    }));
  const before = await read();
  const begin = performance.now();
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 30000));
    samples.push({
      seconds: (performance.now() - begin) / 1000,
      processes: await app.evaluate(({ app }) => app.getAppMetrics()),
      metrics: await read(),
    });
    console.log(
      JSON.stringify({ sample: i + 1, seconds: samples.at(-1).seconds }),
    );
  }
  const after = samples.at(-1).metrics;
  function summary(key) {
    const histogram = after[key].frameHistogram.map(
      (n, i) => n - before[key].frameHistogram[i],
    );
    const count = histogram.reduce((a, b) => a + b, 0);
    const quantile = (p) => {
      let sum = 0;
      for (let i = 0; i < histogram.length; i++) {
        sum += histogram[i];
        if (sum >= count * p) return i;
      }
    };
    return {
      count,
      p50Ms: quantile(0.5),
      p95Ms: quantile(0.95),
      p99Ms: quantile(0.99),
      histogram,
      drawCalls: after[key].drawCalls,
      triangles: after[key].triangles,
    };
  }
  await writeFile(
    ".artifacts/tests/draw-performance-5min.json",
    JSON.stringify(
      {
        seconds: (performance.now() - begin) / 1000,
        water: summary("water"),
        collection: summary("collection"),
        drops: after.water.dropEvents - before.water.dropEvents,
        firstMinuteDrops:
          samples[1].metrics.water.dropEvents - before.water.dropEvents,
        canvases: after.canvases,
        samples,
        gpu: await app.evaluate(({ app }) => app.getGPUInfo("complete")),
        os: { release: os.release(), cpu: os.cpus()[0]?.model },
        note:
          process.env.PERF_ISOLATED === "1"
            ? "Complete 5-minute rendered-frame intervals, 1ms histogram buckets; >=500ms is last bucket. Native occlusion disabled for automation. Other task-owned Electron benchmarks had completed before this run."
            : "Complete 5-minute rendered-frame intervals, 1ms histogram buckets; >=500ms is last bucket. Native occlusion disabled for automation. Concurrent stability and timing processes also rendered on this host.",
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
