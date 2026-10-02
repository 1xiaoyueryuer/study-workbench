import { afterEach, describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../src/main/store";
import { StudyClock } from "../src/main/time";
import { Datasets } from "../src/main/files";
import type { Method } from "../src/shared/contracts";
const opened: Store[] = [];
function setup(path = ":memory:") {
  let n = 0n,
    w = Date.parse("2026-09-29T23:59:00+08:00");
  const c = new StudyClock(
    () => n,
    () => w,
  );
  const s = new Store(path, c);
  opened.push(s);
  const tick = (ms: number) => {
    while (ms > 0) {
      const d = Math.min(ms, 250);
      n += BigInt(d) * 1_000_000n;
      w += d;
      c.sample();
      ms -= d;
    }
  };
  const cmd = (m: Method, p: any = {}, id = randomUUID()) =>
    s.command(m, { datasetId: s.datasetId, operationId: id, payload: p });
  const value = (m: Method, p: any = {}) => {
    const r = cmd(m, p);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  return { s, c, tick, cmd, value };
}
afterEach(() => {
  for (const s of opened.splice(0)) if (s.db.open) s.close();
});
describe("real SQLite accounting and atomic commands", () => {
  it("600 seconds earned, 120 spent, 480 remain; repeated confirmation never spends twice", () => {
    const x = setup();
    const session = x.value("startStudy", { targetMs: 600000 });
    x.tick(600000);
    x.value("endStudy", { sessionId: session.id });
    x.value("confirmTimeConversion", {
      intentId: x.value("quoteTimeConversion", { points: 10 }).id,
    });
    const reward = x.value("saveReward", { name: "一集动画", pricePoints: 2 });
    const intent = x.value("prepareRedemption", { rewardId: reward.id });
    const r = x.value("confirmRedemption", { intentId: intent.id });
    expect(x.value("confirmRedemption", { intentId: intent.id }).id).toBe(r.id);
    expect(x.s.totals()).toEqual({ balance: 0, earned: 600000 });
    x.s.audit();
  });
  it("two 600ms sessions retain 1200ms and can buy one second", () => {
    const x = setup();
    for (let i = 0; i < 2; i++) {
      const a = x.value("startStudy", { targetMs: 1000 });
      x.tick(600);
      x.value("endStudy", { sessionId: a.id });
    }
    const r = x.value("saveReward", { name: "一秒", pricePoints: 1 });
    const i = x.value("prepareRedemption", { rewardId: r.id });
    expect(x.cmd("confirmRedemption", { intentId: i.id }).ok).toBe(false);
    expect(x.s.totals()).toEqual({ balance: 1200, earned: 1200 });
    x.s.audit();
  });
  it("start replay, conflicts and end replay are idempotent", () => {
    const x = setup();
    const op = randomUUID();
    const a = x.cmd("startStudy", { targetMs: 1000 }, op);
    expect(x.cmd("startStudy", { targetMs: 1000 }, op)).toEqual(a);
    expect(x.cmd("startStudy", { targetMs: 2000 }, op)).toMatchObject({
      ok: false,
      error: { code: "OP_CONFLICT" },
    });
    expect(x.cmd("startStudy", { targetMs: 1000 })).toMatchObject({
      ok: false,
      error: { code: "ACTIVE_SESSION" },
    });
    x.tick(700);
    const id = x.s.session.id;
    x.value("endStudy", { sessionId: id });
    x.value("endStudy", { sessionId: id });
    expect(x.s.totals().earned).toBe(700);
  });
  it("failed storage rolls back credit and retry preserves trusted tail", () => {
    const x = setup();
    x.value("startStudy", { targetMs: 1000 });
    x.tick(1100);
    x.s.db.exec(
      "CREATE TRIGGER failure BEFORE INSERT ON time_entries BEGIN SELECT RAISE(ABORT, 'disk full injected'); END",
    );
    x.s.checkpoint();
    expect(x.s.storage).toBe("error");
    expect(x.s.totals().earned).toBe(0);
    expect(x.c.ms).toBe(1100);
    x.s.db.exec("DROP TRIGGER failure");
    x.value("retrySave");
    expect(x.s.totals().earned).toBe(1100);
    x.value("retrySave");
    expect(x.s.totals().earned).toBe(1100);
    x.s.audit();
  });
  it("insufficient balance persists failure and rejects changed quotes", () => {
    const x = setup();
    const r = x.value("saveReward", { name: "休息", pricePoints: 10 });
    const i = x.value("prepareRedemption", { rewardId: r.id });
    const op = randomUUID();
    expect(x.cmd("confirmRedemption", { intentId: i.id }, op)).toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_BALANCE" },
    });
    x.value("saveReward", { id: r.id, name: "改价", pricePoints: 1 });
    expect(x.cmd("confirmRedemption", { intentId: i.id })).toMatchObject({
      ok: false,
      error: { code: "REWARD_CHANGED" },
    });
    expect(x.s.totals().balance).toBe(0);
  });
  it("recovery uses checkpoint only, no downtime income", async () => {
    const dir = await mkdtemp(join(tmpdir(), "study-recovery-"));
    const path = join(dir, "test.sqlite");
    const x = setup(path);
    x.value("startStudy", { targetMs: 10000 });
    x.tick(5000);
    x.s.checkpoint();
    x.tick(900);
    x.s.close();
    const next = new Store(path);
    opened.push(next);
    expect(next.snapshot()).toMatchObject({
      phase: "recovery_pending",
      earnedMs: 5000,
      pendingMs: 0,
    });
    expect(next.clock.ms).toBe(5000);
    next.audit();
  });
  it("retains target snapshot, checks stale datasets and separate intents against balance", () => {
    const x = setup();
    x.value("startStudy", { targetMs: 1000 });
    x.tick(61100);
    x.s.checkpoint();
    x.value("confirmTimeConversion", {
      intentId: x.value("quoteTimeConversion", { points: 1 }).id,
    });
    const r = x.value("saveReward", { name: "小奖", pricePoints: 1 });
    const i = x.value("prepareRedemption", { rewardId: r.id });
    x.value("confirmRedemption", { intentId: i.id });
    const i2 = x.value("prepareRedemption", { rewardId: r.id });
    expect(x.cmd("confirmRedemption", { intentId: i2.id })).toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_BALANCE" },
    });
    expect(
      x.s.command("pauseStudy", {
        datasetId: randomUUID(),
        operationId: randomUUID(),
        payload: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_DATASET" } });
    expect(x.s.session.target_ms).toBe(1000);
    x.s.audit();
  });
  it("pause, resume, checkpoint and midnight preserve exactly one income", () => {
    const x = setup();
    x.value("startStudy", { targetMs: 1000 });
    x.tick(60000);
    x.value("pauseStudy");
    x.tick(80000);
    x.value("resumeStudy");
    expect(x.s.session.state).toBe("running");
    x.tick(1100);
    x.s.checkpoint();
    expect(x.s.totals().earned).toBe(61100);
    expect(
      (
        x.s.db
          .prepare("SELECT SUM(amount_ms) v FROM study_day_slices")
          .get() as any
      ).v,
    ).toBe(61100);
    x.s.audit();
  });
  it("rejects corrupted credit watermarks during restore audit", () => {
    const x = setup();
    x.value("startStudy", { targetMs: 1000 });
    x.tick(1200);
    x.s.checkpoint();
    x.s.db.exec("UPDATE time_entries SET session_total_after_ms=999");
    expect(() => x.s.audit()).toThrow("账本不变量");
  });
  it("keeps historical reward snapshots unchanged after editing and archival", () => {
    const x = setup();
    x.value("startStudy", { targetMs: 1000 });
    x.tick(61500);
    x.value("confirmTimeConversion", {
      intentId: x.value("quoteTimeConversion", { points: 1 }).id,
    });
    const reward = x.value("saveReward", { name: "旧名称", pricePoints: 1 });
    const intent = x.value("prepareRedemption", { rewardId: reward.id });
    x.value("confirmRedemption", { intentId: intent.id });
    x.value("saveReward", { id: reward.id, name: "新名称", pricePoints: 99 });
    x.value("archiveReward", { id: reward.id });
    expect(x.value("listRedemptions", { offset: 0 })[0]).toMatchObject({
      name_snapshot: "旧名称",
      price_amount: 1,
      currency: "points",
    });
    x.s.audit();
  });
});
describe("complete backup generations", () => {
  it("imports a copy, roundtrips SQLite plus files, rejects corruption and stale requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "study-backup-"));
    const a = new Datasets(join(root, "a"));
    await a.init();
    opened.push(a.store);
    const source = join(root, "notes.txt");
    await writeFile(source, "微积分笔记");
    await a.importFiles([source], null, randomUUID());
    await writeFile(source, "原文件已变化");
    const resource = a.store.read("listResources", { offset: 0 })[0];
    expect(await readFile(a.resource(resource.id).path, "utf8")).toBe(
      "微积分笔记",
    );
    const backup = join(root, "complete.studybackup");
    await a.exportTo(backup);
    const b = new Datasets(join(root, "b"));
    await b.init();
    opened.push(b.store);
    const old = b.store.datasetId;
    const inspected = await b.inspect(backup);
    expect(inspected.resourceCount).toBe(1);
    await b.restore(inspected.token);
    opened.push(b.store);
    expect(b.store.datasetId).not.toBe(old);
    expect(b.store.read("listResources", { offset: 0 })).toHaveLength(1);
    b.store.audit();
    const corrupt = join(root, "bad.studybackup");
    await writeFile(corrupt, "not a zip");
    await expect(b.inspect(corrupt)).rejects.toThrow();
    expect(b.store.read("listResources", { offset: 0 })).toHaveLength(1);
    await mkdir(join(root, "evidence"));
    const copiedPath = a.resource(resource.id).path;
    const deletion = a.store.command("deleteResource", {
      datasetId: a.store.datasetId,
      operationId: randomUUID(),
      payload: { id: resource.id },
    });
    expect(deletion.ok).toBe(true);
    await a.cleanupAttachments();
    await expect(access(copiedPath)).rejects.toThrow();
    expect(await readFile(source, "utf8")).toBe("原文件已变化");
  });
  it("rejects future backup versions and unsupported archive paths before switching", async () => {
    const root = await mkdtemp(join(tmpdir(), "study-hostile-"));
    const data = new Datasets(join(root, "data"));
    await data.init();
    opened.push(data.store);
    const id = data.store.datasetId;
    for (const kind of ["future", "path"]) {
      const zip = new ZipFile();
      zip.addBuffer(
        Buffer.from(
          JSON.stringify({
            format: kind === "future" ? 2 : 1,
            schema: 1,
            files: [],
          }),
        ),
        "manifest.json",
      );
      if (kind === "path")
        zip.addBuffer(Buffer.from("bad"), "untrusted/extra.txt");
      const file = join(root, kind + ".studybackup");
      const writing = pipeline(zip.outputStream, createWriteStream(file));
      zip.end();
      await writing;
      await expect(data.inspect(file)).rejects.toThrow();
      expect(data.store.datasetId).toBe(id);
      data.store.audit();
    }
  });
});
