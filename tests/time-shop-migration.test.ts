import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  access,
  mkdir,
  writeFile,
  cp,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migration } from "../src/main/schema";
import { migration2 } from "../src/main/migrations/002";
import { migration3 } from "../src/main/migrations/003";
import { Datasets } from "../src/main/files";
import { Store } from "../src/main/store";
import { defaults, schemas } from "../src/shared/contracts";

const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) if (s.db.open) s.close();
});

it.each([2, 3])(
  "upgrades schema %i: removes collectibles/points, returns unspent converted time, preserves reward receipts and files",
  async (version) => {
    const dir = await mkdtemp(join(tmpdir(), "study-time-upgrade-"));
    const path = join(dir, "study.sqlite");
    const db = new Database(path);
    db.pragma("foreign_keys=ON");
    db.exec(migration);
    const at = "2026-10-01T00:00:00Z";
    for (const [k, v] of Object.entries({
      dataset_id: randomUUID(),
      revision: "0",
      schema_version: String(version),
    }))
      db.prepare("INSERT INTO app_meta VALUES(?,?)").run(k, v);
    for (const [k, v] of Object.entries(defaults))
      db.prepare("INSERT INTO settings VALUES(?,1,?)").run(
        k,
        JSON.stringify(v),
      );
    const session = randomUUID(),
      entry = randomUUID();
    db.prepare(
      "INSERT INTO study_sessions(id,state,target_ms,started_at,credited_ms) VALUES(?,'ended',600000,?,600000)",
    ).run(session, at);
    db.prepare(
      "INSERT INTO time_entries(id,kind,amount_ms,session_id,session_total_after_ms,created_at) VALUES(?,'study',600000,?,600000,?)",
    ).run(entry, session, at);
    db.prepare(
      "INSERT INTO study_day_slices VALUES(?,'2026-10-01','Asia/Shanghai',600000)",
    ).run(entry);
    db.exec(migration2);
    if (version === 3) db.exec(migration3);
    [migration, migration2, ...(version === 3 ? [migration3] : [])].forEach(
      (sql, i) =>
        db
          .prepare("INSERT INTO schema_migrations VALUES(?,?,?)")
          .run(i + 1, createHash("sha256").update(sql).digest("hex"), at),
    );
    const conversion = randomUUID();
    db.prepare("INSERT INTO time_conversions VALUES(?,?,600000,10,1,?)").run(
      conversion,
      randomUUID(),
      at,
    );
    db.prepare(
      "INSERT INTO time_entries(id,kind,amount_ms,conversion_id,created_at) VALUES(?,'conversion',-600000,?,?)",
    ).run(randomUUID(), conversion, at);
    db.prepare(
      "INSERT INTO point_entries(id,amount,kind,conversion_id,created_at) VALUES(?,10,'conversion',?,?)",
    ).run(randomUUID(), conversion, at);
    const reward = randomUUID(),
      intent = randomUUID(),
      receipt = randomUUID();
    db.prepare("INSERT INTO rewards VALUES(?,'散步',2,1,NULL)").run(reward);
    db.prepare(
      "INSERT INTO redemption_intents VALUES(?,?,1,'散步',2,'confirmed',?,'points')",
    ).run(intent, reward, receipt);
    db.prepare("INSERT INTO redemptions VALUES(?,?,?,'散步',2,?,'points')").run(
      receipt,
      intent,
      reward,
      at,
    );
    db.prepare(
      "INSERT INTO point_entries(id,amount,kind,redemption_id,created_at) VALUES(?,-2,'purchase',?,?)",
    ).run(randomUUID(), receipt, at);
    const course = randomUUID();
    db.prepare(
      "INSERT INTO courses(id,name,normalized_name) VALUES(?,'数学','数学')",
    ).run(course);
    db.prepare(
      "INSERT INTO resources(id,title,course_id,kind,url,created_at) VALUES(?,'笔记',?,'url','https://example.com',?)",
    ).run(randomUUID(), course, at);
    db.close();
    const s = new Store(path);
    stores.push(s);
    s.audit();
    expect(s.totals()).toEqual({ earned: 600000, balance: 480000 });
    expect(s.read("listRewards", {})[0]).toMatchObject({
      name: "散步",
      price_ms: 120000,
    });
    expect(s.read("listRedemptions", { offset: 0 })[0]).toMatchObject({
      id: receipt,
      price_amount: 120000,
      charged_ms: 120000,
    });
    expect(s.read("listResources", { offset: 0 })[0].title).toBe("笔记");
    const tables = s.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(
      tables.some((t) =>
        /loot|collectible|point_entries|sales|time_conversions/.test(t.name),
      ),
    ).toBe(false);
    expect(s.snapshot()).not.toHaveProperty("pointsBalance");
    expect(schemas).not.toHaveProperty("collectLoot");
    await expect(access(path + ".before-v4")).resolves.toBeUndefined();
    const result = s.command("confirmRedemption", {
      datasetId: s.datasetId,
      operationId: randomUUID(),
      payload: { intentId: intent },
    });
    expect(result).toMatchObject({ ok: true, value: { id: receipt } });
    expect(s.totals().balance).toBe(480000);
    s.close();
    const again = new Store(path);
    stores.push(again);
    again.audit();
    expect(again.totals().balance).toBe(480000);
    const datasetRoot = join(dir, "dataset-route"),
      datasetId = randomUUID();
    const datasetDir = join(datasetRoot, "datasets", datasetId);
    await mkdir(join(datasetDir, "attachments"), { recursive: true });
    await cp(path + ".before-v4", join(datasetDir, "study.sqlite"));
    await writeFile(
      join(datasetRoot, "current.json"),
      JSON.stringify({ id: datasetId }),
    );
    const d = new Datasets(datasetRoot);
    await d.init();
    stores.push(d.store);
    const backups = await readdir(join(datasetRoot, "backups"));
    expect(
      backups.some(
        (f) => f.startsWith("before-upgrade-") && f.endsWith(".studybackup"),
      ),
    ).toBe(true);
    const inspected = await d.inspect(
      join(
        datasetRoot,
        "backups",
        backups.find((f) => f.endsWith(".studybackup"))!,
      ),
    );
    expect(inspected.earnedMs).toBe(600000);
    d.store.audit();

    // Old purchases funded by collectible sales must not manufacture negative time.
    const salePath = join(dir, "sale-funded.sqlite");
    await cp(path + ".before-v4", salePath);
    const legacy = new Database(salePath);
    legacy.pragma("foreign_keys=ON");
    const saleIntent = randomUUID(),
      sale = randomUUID(),
      reward2 = randomUUID(),
      intent2 = randomUUID(),
      receipt2 = randomUUID();
    legacy
      .prepare(
        "INSERT INTO business_intents VALUES(?,'sale','[]',20,'confirmed','{}')",
      )
      .run(saleIntent);
    legacy
      .prepare("INSERT INTO sales VALUES(?,?,'[]',20,?)")
      .run(sale, saleIntent, at);
    legacy
      .prepare(
        "INSERT INTO point_entries(id,amount,kind,sale_id,created_at) VALUES(?,20,'sale',?,?)",
      )
      .run(randomUUID(), sale, at);
    legacy
      .prepare("INSERT INTO rewards VALUES(?,'旧大额奖励',15,1,NULL)")
      .run(reward2);
    legacy
      .prepare(
        "INSERT INTO redemption_intents VALUES(?,?,1,'旧大额奖励',15,'confirmed',?,'points')",
      )
      .run(intent2, reward2, receipt2);
    legacy
      .prepare(
        "INSERT INTO redemptions VALUES(?,?,?,'旧大额奖励',15,?,'points')",
      )
      .run(receipt2, intent2, reward2, at);
    legacy
      .prepare(
        "INSERT INTO point_entries(id,amount,kind,redemption_id,created_at) VALUES(?,-15,'purchase',?,?)",
      )
      .run(randomUUID(), receipt2, at);
    legacy.close();
    const migrated = new Store(salePath);
    stores.push(migrated);
    migrated.audit();
    expect(migrated.totals()).toEqual({ earned: 600000, balance: 0 });
    expect(
      migrated
        .read("listRedemptions", { offset: 0 })
        .find((r: { id: string }) => r.id === receipt2),
    ).toMatchObject({ price_amount: 900000, charged_ms: 480000 });
  },
);
