import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/store";
import { migration } from "../src/main/schema";
import { defaults, type Method } from "../src/shared/contracts";
import { StudyClock } from "../src/main/time";
import { advanceLoot, draw } from "../src/main/collection/loot";
import { Datasets } from "../src/main/files";
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) if (s.db.open) s.close();
});
function setup() {
  let n = 0n,
    w = Date.parse("2026-09-29T23:59:00+08:00");
  const c = new StudyClock(
      () => n,
      () => w,
    ),
    s = new Store(":memory:", c);
  stores.push(s);
  const cmd = (m: Method, p: unknown = {}, op = randomUUID()) =>
    s.command(m, { datasetId: s.datasetId, operationId: op, payload: p });
  const value = (m: Method, p: unknown = {}) => {
    const r = cmd(m, p);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const tick = (ms: number) => {
    while (ms) {
      const d = Math.min(ms, 250);
      n += BigInt(d) * 1000000n;
      w += d;
      c.sample();
      ms -= d;
    }
  };
  return { s, c, cmd, value, tick };
}
describe("v0.4 durable economy and collection", () => {
  it("600s -> 10 points -> 2 point reward -> white sale, replay and rollback", () => {
    const x = setup();
    x.value("startStudy", { targetMs: 600000 });
    x.tick(600000);
    x.value("pauseStudy");
    const q = x.value("quoteTimeConversion", { points: 10 });
    const r = x.value("confirmTimeConversion", { intentId: q.id });
    expect(x.value("confirmTimeConversion", { intentId: q.id })).toEqual(r);
    const reward = x.value("saveReward", { name: "茶", pricePoints: 2 });
    x.value("confirmRedemption", {
      intentId: x.value("prepareRedemption", { rewardId: reward.id }).id,
    });
    expect(x.s.snapshot().pointsBalance).toBe(8);
    x.s.db
      .prepare(
        "UPDATE loot_state SET target_ms=600000,progress_ms=599999,catalog_id='pebble'",
      )
      .run();
    x.s.db.transaction(() => advanceLoot(x.s.db, 1))();
    const item = x.value("getInventory")[0];
    const sale = x.value("quoteSale", { ids: [item.id] });
    x.s.db.exec(
      "CREATE TRIGGER fail_sale BEFORE INSERT ON point_entries BEGIN SELECT RAISE(ABORT,'disk full'); END",
    );
    expect(x.cmd("confirmSale", { intentId: sale.id }).ok).toBe(false);
    expect(x.value("getInventory")).toHaveLength(1);
    x.s.db.exec("DROP TRIGGER fail_sale");
    x.value("retrySave");
    x.value("confirmSale", { intentId: sale.id });
    x.value("confirmSale", { intentId: sale.id });
    expect(x.s.snapshot().pointsBalance).toBe(9);
    expect(x.s.totals()).toEqual({ earned: 600000, balance: 0 });
    x.s.audit();
  });
  it("capacity freezes without backlog; full warehouse exchange is atomic", () => {
    const x = setup();
    const drop = () => {
      x.s.db.prepare("UPDATE loot_state SET progress_ms=target_ms-1").run();
      x.s.db.transaction(() => advanceLoot(x.s.db, 1))();
    };
    for (let i = 0; i < 50; i++) drop();
    const first = x.value("getInventory")[0];
    x.value("placeCollectible", { id: first.id, tankIndex: 0 });
    drop();
    const before = x.s.db.prepare("SELECT * FROM loot_state").get();
    x.s.db.transaction(() => advanceLoot(x.s.db, 3600000))();
    expect(x.s.db.prepare("SELECT * FROM loot_state").get()).toEqual(before);
    expect(x.cmd("returnCollectible", { id: first.id }).ok).toBe(false);
    const second = x.value("getInventory")[0];
    x.value("placeCollectible", { id: second.id, tankIndex: 0 });
    expect(x.value("getInventory")).toHaveLength(50);
    expect(x.value("getCollection")[0].id).toBe(second.id);
    const sale = x.value("quoteSale", { ids: [first.id] });
    x.value("confirmSale", { intentId: sale.id });
    expect(x.s.snapshot().inventoryCount).toBe(49);
    expect(x.s.db.prepare("SELECT * FROM loot_state").get()).toEqual(before);
    x.s.audit();
  });
  it("RNG interval and all rarity boundaries are deterministic", () => {
    for (const [roll, rarity] of [
      [0, 0],
      [4999, 0],
      [5000, 1],
      [7799, 1],
      [7800, 2],
      [9199, 2],
      [9200, 3],
      [9799, 3],
      [9800, 4],
      [9979, 4],
      [9980, 5],
      [9999, 5],
    ]) {
      let n = 0;
      const result = draw((min, max) => {
        expect(max).toBeGreaterThan(min);
        return n++ === 0 ? 1800000 : n === 2 ? roll : 0;
      });
      expect(result.target).toBe(1800000);
      expect(result.item.rarity).toBe(rarity);
    }
    expect(draw((min) => min).target).toBe(600000);
  });
  it("checkpoint growth is bounded to one income and one row per day", () => {
    const x = setup();
    x.value("startStudy", { targetMs: 600000 });
    for (let i = 0; i < 300; i++) {
      x.tick(5000);
      x.s.checkpoint();
    }
    expect(
      x.s.db
        .prepare("SELECT COUNT(*) n FROM time_entries WHERE kind='study'")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      x.s.db.prepare("SELECT COUNT(*) n FROM study_day_slices").get(),
    ).toEqual({ n: 2 });
    expect(x.s.totals().earned).toBe(1500000);
    x.s.audit();
  });
  it("course deletion preserves file references by default", () => {
    const x = setup();
    const c = x.value("createCourse", { name: "高数" });
    x.value("saveLink", {
      courseId: c.id,
      title: "笔记",
      url: "https://example.com",
      note: "保留",
    });
    x.value("deleteCourse", { id: c.id });
    expect(x.value("listResources", { offset: 0 })[0]).toMatchObject({
      title: "笔记",
      note: "保留",
      course_name: "未归档",
    });
  });
});
it("real published v1 migration preserves time, slices, receipts, links, quote replay and recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "study-v1-")),
    path = join(dir, "study.sqlite"),
    db = new Database(path);
  db.exec(migration);
  const at = "2026-09-29T16:00:00Z";
  db.prepare("INSERT INTO schema_migrations VALUES(1,?,?)").run(
    createHash("sha256").update(migration).digest("hex"),
    at,
  );
  for (const [k, v] of Object.entries({
    dataset_id: randomUUID(),
    revision: "0",
    schema_version: "1",
  }))
    db.prepare("INSERT INTO app_meta VALUES(?,?)").run(k, v);
  for (const [k, v] of Object.entries(defaults))
    db.prepare("INSERT INTO settings VALUES(?,1,?)").run(k, JSON.stringify(v));
  const session = randomUUID(),
    reward = randomUUID(),
    intent = randomUUID(),
    receipt = randomUUID(),
    course = randomUUID();
  db.prepare(
    "INSERT INTO study_sessions(id,state,target_ms,started_at,credited_ms) VALUES(?,'running',600000,?,120000)",
  ).run(session, at);
  for (let i = 1; i <= 2; i++) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO time_entries(id,kind,amount_ms,session_id,session_total_after_ms,created_at) VALUES(?,'study',60000,?,?,?)",
    ).run(id, session, i * 60000, at);
    db.prepare("INSERT INTO study_day_slices VALUES(?,?,?,60000)").run(
      id,
      `2026-09-${28 + i}`,
      "Asia/Shanghai",
    );
  }
  db.prepare("INSERT INTO rewards VALUES(?,?,61,1,NULL)").run(reward, "旧奖励");
  db.prepare(
    "INSERT INTO redemption_intents VALUES(?,?,1,'旧奖励',61,'confirmed',?)",
  ).run(intent, reward, receipt);
  db.prepare("INSERT INTO redemptions VALUES(?,?,?,'旧奖励',61,?)").run(
    receipt,
    intent,
    reward,
    at,
  );
  db.prepare(
    "INSERT INTO time_entries(id,kind,amount_ms,redemption_id,created_at) VALUES(?,'redeem',-61000,?,?)",
  ).run(randomUUID(), receipt, at);
  db.prepare("INSERT INTO resource_categories VALUES(?,'数学','数学')").run(
    course,
  );
  db.prepare(
    "INSERT INTO resources(id,title,category_id,kind,url,created_at) VALUES(?,'资料',?,'url','https://example.com',?)",
  ).run(randomUUID(), course, at);
  db.close();
  const s = new Store(path);
  stores.push(s);
  expect(s.totals()).toEqual({ earned: 120000, balance: 59000 });
  expect(s.snapshot()).toMatchObject({
    pointsBalance: 0,
    inventoryCount: 0,
    phase: "recovery_pending",
    migrationNotice: true,
  });
  expect(s.read("listRewards", {})[0].price_points).toBe(2);
  expect(s.read("listRedemptions", { offset: 0 })[0]).toMatchObject({
    price_amount: 61000,
    currency: "study_ms",
  });
  expect(
    s.command("confirmRedemption", {
      datasetId: s.datasetId,
      operationId: randomUUID(),
      payload: { intentId: intent },
    }),
  ).toMatchObject({ ok: true, value: { id: receipt } });
  expect(
    s.read("listCourses", {}).some((c: { id: string }) => c.id === course),
  ).toBe(true);
  expect(s.db.prepare("SELECT progress_ms FROM loot_state").get()).toEqual({
    progress_ms: 0,
  });
  s.audit();
  expect((await readdir(dir)).includes("study.sqlite.before-v2")).toBe(true);
});
it("identical content shares one entity, errors are per file, and repeated backup inspections clean staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-dedup-")),
    d = new Datasets(join(root, "data"));
  await d.init();
  stores.push(d.store);
  const c = d.store.command("createCourse", {
    datasetId: d.store.datasetId,
    operationId: randomUUID(),
    payload: { name: "数学" },
  });
  if (!c.ok) throw Error("course");
  const file = join(root, "中文.txt");
  await writeFile(file, "相同内容");
  await d.importFiles([file], null, randomUUID());
  await d.importFiles([file], c.value.id, randomUUID());
  await d.importFiles([file], c.value.id, randomUUID());
  expect(
    d.store.db.prepare("SELECT COUNT(*) n FROM attachments").get(),
  ).toEqual({ n: 1 });
  expect(d.store.db.prepare("SELECT COUNT(*) n FROM resources").get()).toEqual({
    n: 2,
  });
  const bad = join(root, "bad.exe");
  await writeFile(bad, "no");
  expect(
    (await d.importFiles([bad], null, randomUUID())).results[0].status,
  ).toBe("failed");
  const backup = join(root, "b.studybackup");
  for (let i = 0; i < 20; i++) {
    await d.exportTo(backup);
    await d.inspect(backup);
  }
  expect((await readdir(join(d.root, "staging"))).length).toBe(1);
  expect(await readFile(file, "utf8")).toBe("相同内容");
});
it("interrupted schema DDL rolls back every prior step and closes the failed connection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "study-migration-failure-")),
    path = join(dir, "study.sqlite"),
    db = new Database(path);
  db.exec(migration);
  db.prepare("INSERT INTO schema_migrations VALUES(1,?,?)").run(
    createHash("sha256").update(migration).digest("hex"),
    new Date().toISOString(),
  );
  for (const [k, v] of Object.entries({
    dataset_id: randomUUID(),
    revision: "0",
    schema_version: "1",
  }))
    db.prepare("INSERT INTO app_meta VALUES(?,?)").run(k, v);
  for (const [k, v] of Object.entries(defaults))
    db.prepare("INSERT INTO settings VALUES(?,1,?)").run(k, JSON.stringify(v));
  db.exec("CREATE TABLE point_entries(injected_failure TEXT)");
  db.close();
  expect(() => new Store(path)).toThrow();
  const check = new Database(path);
  expect(
    check
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='resource_categories'",
      )
      .get(),
  ).toBeTruthy();
  expect(
    check.prepare("SELECT name FROM sqlite_master WHERE name='courses'").get(),
  ).toBeUndefined();
  expect(
    check.prepare("SELECT MAX(version) n FROM schema_migrations").get(),
  ).toEqual({ n: 1 });
  check.exec("DROP TABLE point_entries");
  check.close();
  const retry = new Store(path);
  stores.push(retry);
  retry.audit();
  expect(retry.snapshot().pointsBalance).toBe(0);
});
