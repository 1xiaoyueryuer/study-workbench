import { validationArgs, parkWindow } from "./validation-window.mjs";
import { _electron as electron } from "@playwright/test";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

// Fixed five-minute warmup and sixty-minute measured run. No forced GC/cache clearing.
const diagnostic = process.argv.includes("--diagnostic");
const root = await mkdtemp(join(tmpdir(), "study-v1-performance-"));
const env = { ...process.env, STUDY_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(".artifacts/tests", { recursive: true });
const app = await electron.launch({
  executablePath: process.env.STUDY_PERF_EXE,
  args: [
    ...(process.env.STUDY_PERF_EXE ? [] : ["."]),
    "--force-device-scale-factor=1.25",
    ...validationArgs,
  ],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "开始学习" }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1352, 731);
    w.setSkipTaskbar(true);
    w.showInactive();
  });
  await parkWindow(app);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const invoke = async (method, payload = {}) =>
    page.evaluate(
      async ({ method, payload }) => {
        const s = await window.workbench.getSnapshot({
          datasetId: "",
          operationId: crypto.randomUUID(),
          payload: {},
        });
        if (!s.ok) throw Error(s.error.message);
        const r = await window.workbench[method]({
          datasetId: s.value.datasetId,
          operationId: crypto.randomUUID(),
          payload,
        });
        if (!r.ok) throw Error(r.error.message);
        return r.value;
      },
      { method, payload },
    );
  await invoke("startStudy", { targetMs: 3600000 });
  const start = performance.now();
  const sample = async () => {
    const processes = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({
        pid: p.pid,
        type: p.type,
        memory: p.memory,
        cpu: p.cpu,
      })),
    );
    const perf = await cdp.send("Performance.getMetrics");
    const dom = await cdp.send("Memory.getDOMCounters");
    const water = await page.evaluate(() => ({
      frames: window.tankMetrics?.frames,
      histogram: window.tankMetrics?.frameHistogram,
      drawCalls: window.tankMetrics?.drawCalls,
      geometries: window.tankMetrics?.geometries,
      textures: window.tankMetrics?.textures,
      canvases: document.querySelectorAll("canvas").length,
      dimensions: [innerWidth, innerHeight, devicePixelRatio],
    }));
    return {
      seconds: (performance.now() - start) / 1000,
      privateMiB: processes.reduce(
        (n, p) => n + p.memory.privateBytes / 1024,
        0,
      ),
      processes,
      dom,
      js: Object.fromEntries(
        perf.metrics
          .filter((m) =>
            [
              "JSHeapUsedSize",
              "JSHeapTotalSize",
              "Nodes",
              "Documents",
              "JSEventListeners",
            ].includes(m.name),
          )
          .map((m) => [m.name, m.value]),
      ),
      water,
    };
  };
  if (diagnostic) {
    await cdp.send("HeapProfiler.startSampling", { samplingInterval: 32768 });
    const before = await sample();
    await page.waitForTimeout(60000);
    const profile = await cdp.send("HeapProfiler.stopSampling");
    const after = await sample();
    const allocations = [];
    function visit(n) {
      if (n.selfSize)
        allocations.push({
          bytes: n.selfSize,
          name: n.callFrame.functionName,
          url: n.callFrame.url,
          line: n.callFrame.lineNumber,
        });
      for (const c of n.children ?? []) visit(c);
    }
    visit(profile.profile.head);
    allocations.sort((a, b) => b.bytes - a.bytes);
    await writeFile(
      ".artifacts/tests/memory-diagnostic.json",
      JSON.stringify(
        { before, after, allocations: allocations.slice(0, 40) },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        diagnostic: true,
        before: before.privateMiB,
        after: after.privateMiB,
        domBefore: before.dom,
        domAfter: after.dom,
        allocations: allocations.slice(0, 5),
      }),
    );
  } else {
    const warmup = [],
      samples = [];
    const output = resolve(".artifacts/tests/performance-v1.json");
    const persist = async (extra = {}) =>
      writeFile(
        output,
        JSON.stringify(
          {
            conditions: {
              warmupSeconds: 300,
              measuredSeconds: 3600,
              intervalSeconds: 30,
              forcedGC: false,
              scale: 1.25,
              content: [1352, 731],
              memoryBudgetMiB: 16,
            },
            warmup,
            samples,
            ...extra,
          },
          null,
          2,
        ),
      );
    for (let round = 0; round < 20; round++)
      for (const name of [
        "学习记录",
        "学习资料",
        "奖励商店",
        "设置",
        "学习首页",
      ])
        await page.getByRole("button", { name, exact: true }).click();
    const reward = await invoke("saveReward", {
      name: "隔离压力兑换",
      priceMs: 1,
    });
    for (let n = 0; n < 100; n++) {
      const q = await invoke("prepareRedemption", { rewardId: reward.id });
      await invoke("confirmRedemption", { intentId: q.id });
    }
    // Match the original acceptance order: pressure, fixed warmup, measured run.
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(30000);
      warmup.push(await sample());
      assert(
        warmup.at(-1).water.frames - (warmup.at(-2)?.water.frames ?? 0) > 500,
        "Water drawing was throttled; invalid performance conditions",
      );
      await persist();
      console.log(
        JSON.stringify({
          phase: "warmup",
          sample: i + 1,
          privateMiB: warmup.at(-1).privateMiB,
        }),
      );
    }
    const measuredStart = performance.now();
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(30000);
      samples.push(await sample());
      await persist({
        measuredSeconds: (performance.now() - measuredStart) / 1000,
      });
      console.log(
        JSON.stringify({
          phase: "measured",
          sample: i + 1,
          privateMiB: samples.at(-1).privateMiB,
          jsMiB: samples.at(-1).js.JSHeapUsedSize / 1024 ** 2,
          dom: samples.at(-1).dom,
        }),
      );
    }
    const median = (a) => {
      const b = [...a].sort((x, y) => x - y);
      return (
        (b[Math.floor((b.length - 1) / 2)] + b[Math.ceil((b.length - 1) / 2)]) /
        2
      );
    };
    const baseline = median(warmup.slice(-5).map((s) => s.privateMiB));
    const final = median(samples.slice(-20).map((s) => s.privateMiB));
    const growth = final - baseline;
    const histogram = samples
      .at(-1)
      .water.histogram.map((n, i) => n - warmup.at(-1).water.histogram[i]);
    const count = histogram.reduce((a, b) => a + b, 0);
    let sum = 0,
      p95 = 0;
    for (let i = 0; i < histogram.length; i++) {
      sum += histogram[i];
      if (sum >= count * 0.95) {
        p95 = i;
        break;
      }
    }
    const summary = {
      baselineMiB: baseline,
      finalMiB: final,
      growthMiB: growth,
      waterP95Ms: p95,
      passed: growth <= 16 && p95 <= 26.4,
      pageCycles: 20,
      redemptions: 100,
      measuredSeconds: (performance.now() - measuredStart) / 1000,
    };
    await persist({ summary });
    console.log(JSON.stringify(summary));
    assert(summary.passed, "V1 memory/frame budget failed");
  }
  await cdp.detach();
} finally {
  await app.close();
}
