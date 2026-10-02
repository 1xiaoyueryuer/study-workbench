import { _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = await mkdtemp(join(tmpdir(), "study-real-time-"));
const env = { ...process.env, STUDY_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const page = await app.firstWindow();
await page.getByRole("button", { name: "开始学习" }).waitFor();
const command = async (method, payload = {}) =>
  page.evaluate(
    async ({ method, payload }) => {
      const snapshot = await new Promise((resolve) => {
        const off = window.workbench.subscribeSnapshot((s) => {
          off();
          resolve(s);
        });
      });
      return window.workbench[method]({
        datasetId: snapshot.datasetId,
        operationId: crypto.randomUUID(),
        payload,
      });
    },
    { method, payload },
  );
const start = await command("startStudy", { targetMs: 60000 });
if (!start.ok) throw new Error(start.error.message);
const begin = process.hrtime.bigint();
const samples = [];
await mkdir(".artifacts/tests", { recursive: true });
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 30000));
  const referenceMs = Number(process.hrtime.bigint() - begin) / 1e6;
  const s = await command("getSnapshot");
  const metrics = await page.evaluate(() => {
    const m = window.tankMetrics;
    if (!m) return null;
    const times = m.frameMs.slice().sort((a, b) => a - b);
    return {
      ...m,
      frameMs: undefined,
      p95Ms: times[Math.floor(times.length * 0.95)],
    };
  });
  const processes = await app.evaluate(({ app }) => app.getAppMetrics());
  samples.push({ referenceMs, snapshot: s.value, metrics, processes });
  await writeFile(
    ".artifacts/tests/real-time-progress.json",
    JSON.stringify({ samples }, null, 2),
  );
  if (i === 0 || i === 2)
    await page.screenshot({
      path: resolve(
        `.artifacts/tests/real-${i === 0 ? "half" : "overflow"}.png`,
      ),
    });
  console.log(
    JSON.stringify({
      sample: i + 1,
      referenceMs,
      effectiveMs: s.value.session.effectiveMs,
      phase: s.value.phase,
    }),
  );
}
const end = await command("endStudy", { sessionId: start.value.id });
const referenceMs = Number(process.hrtime.bigint() - begin) / 1e6;
const snapshot = await command("getSnapshot");
const gpu = await app.evaluate(({ app }) => app.getGPUInfo("complete"));
await writeFile(
  ".artifacts/tests/real-time-10min.json",
  JSON.stringify(
    {
      referenceMs,
      creditedMs: end.value.credited_ms,
      errorMs: end.value.credited_ms - referenceMs,
      snapshot: snapshot.value,
      samples,
      gpu,
      note: "External process.hrtime reference begins after start response; IPC sample acquisition adds overhead. No injected clock.",
    },
    null,
    2,
  ),
);
await app.close();
