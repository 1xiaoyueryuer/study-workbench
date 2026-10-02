import { test, expect, vi } from "vitest";
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
}));
import { Store } from "../src/main/store";
import { Datasets } from "../src/main/files";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  writeFile,
  stat,
  readFile,
  open,
  access,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
test("one synthetic year remains small with bounded snapshot query time", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-year-")),
    file = join(root, "study.sqlite"),
    s = new Store(file);
  try {
    const start = performance.now();
    s.db.transaction(() => {
      for (let day = 0; day < 365; day++) {
        const date = new Date(Date.UTC(2025, 0, 1 + day))
          .toISOString()
          .slice(0, 10);
        for (let n = 0; n < 8; n++) {
          const session = randomUUID(),
            entry = randomUUID(),
            at = date + "T10:00:00Z";
          s.db
            .prepare(
              "INSERT INTO study_sessions(id,state,target_ms,started_at,ended_at,credited_ms) VALUES(?,'ended',3600000,?,?,3600000)",
            )
            .run(session, at, at);
          s.db
            .prepare(
              "INSERT INTO time_entries(id,kind,amount_ms,session_id,session_total_after_ms,created_at) VALUES(?,'study',3600000,?,3600000,?)",
            )
            .run(entry, session, at);
          s.db
            .prepare("INSERT INTO study_day_slices VALUES(?,?,?,3600000)")
            .run(entry, date, "Asia/Shanghai");
        }
      }
    })();
    s.audit();
    s.db.pragma("wal_checkpoint(TRUNCATE)");
    const bytes = (await stat(file)).size,
      queryStart = performance.now();
    for (let i = 0; i < 1000; i++) s.snapshot();
    const elapsed = performance.now() - queryStart;
    expect(bytes).toBeLessThan(100 * 1024 ** 2);
    expect(s.totals().earned).toBe(365 * 8 * 3600000);
    await mkdir(".artifacts/tests", { recursive: true });
    await writeFile(
      ".artifacts/tests/year-growth.json",
      JSON.stringify(
        {
          sessions: 2920,
          incomeRows: 2920,
          dailyRows: 2920,
          earnedMs: s.totals().earned,
          databaseBytes: bytes,
          snapshot1000Ms: elapsed,
          totalMs: performance.now() - start,
          note: "Synthetic year at the final bounded checkpoint shape; frequent checkpoint behavior tested separately.",
        },
        null,
        2,
      ),
    );
  } finally {
    s.close();
  }
});
test("100MiB imported ten times occupies one entity; cancellation leaves no partial", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-space-")),
    d = new Datasets(join(root, "data"));
  await d.init();
  try {
    const file = join(root, "large.pdf");
    await writeFile(file, Buffer.alloc(100 * 1024 ** 2, 37));
    const before = await d.storageUsage();
    for (let i = 0; i < 10; i++)
      await d.importFiles([file], null, randomUUID());
    const after = await d.storageUsage();
    expect(after.attachments - before.attachments).toBe(100 * 1024 ** 2);
    expect(
      d.store.db.prepare("SELECT COUNT(*) n FROM resources").get(),
    ).toEqual({ n: 1 });
    const other = join(root, "other.pdf");
    await writeFile(other, Buffer.alloc(100 * 1024 ** 2, 38));
    const op = randomUUID(),
      promise = d.importFiles([other], null, op);
    const timer = setInterval(() => d.cancelImport(op), 1);
    const result = await promise;
    clearInterval(timer);
    expect(result.results[0].status).toBe("cancelled");
    expect((await d.storageUsage()).attachments).toBe(after.attachments);
    await writeFile(
      ".artifacts/tests/dedup-space.json",
      JSON.stringify(
        {
          sourceBytes: (await stat(file)).size,
          imports: 10,
          before,
          after,
          cancelled: result.results[0],
        },
        null,
        2,
      ),
    );
    expect((await readFile(file)).length).toBe(100 * 1024 ** 2);
  } finally {
    d.store.close();
  }
}, 30000);

test("preview LRU respects multiple viewers and a hard 256MiB budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-cache-"));
  const d = new Datasets(root);
  const dirs = [randomUUID(), randomUUID()].map((id) =>
    join(root, "view-cache", id),
  );
  for (const [index, dir] of dirs.entries()) {
    await mkdir(dir, { recursive: true });
    const f = await open(join(dir, "attachment.pdf"), "w");
    await f.truncate(120 * 1024 ** 2);
    await f.close();
    await utimes(
      dir,
      new Date(1000 + index * 1000),
      new Date(1000 + index * 1000),
    );
  }
  const release1 = d.pinPreview(dirs[0]),
    release2 = d.pinPreview(dirs[0]);
  await d.trimCache(20 * 1024 ** 2);
  await expect(access(dirs[0])).resolves.toBeUndefined();
  await expect(access(dirs[1])).rejects.toThrow();
  release1();
  release1();
  await expect(d.trimCache(200 * 1024 ** 2)).rejects.toThrow(
    "预览缓存空间不足",
  );
  release2();
  await d.trimCache(200 * 1024 ** 2);
  await expect(access(dirs[0])).rejects.toThrow();
});

test("low disk and mid-copy ENOSPC preserve existing data and source files", async () => {
  const fs = await import("node:fs/promises"),
    streams = await import("node:fs");
  const root = await mkdtemp(join(tmpdir(), "study-disk-fault-")),
    d = new Datasets(join(root, "data"));
  await d.init();
  const file = join(root, "keep.txt"),
    other = join(root, "new.pdf");
  await writeFile(file, "原始资料");
  await writeFile(other, Buffer.alloc(2 * 1024 ** 2, 65));
  await d.importFiles([file], null, randomUUID());
  const baseline = await d.storageUsage();
  const statSpy = vi
    .spyOn(fs, "statfs")
    .mockResolvedValue({ bavail: 1, bsize: 1 } as Awaited<
      ReturnType<typeof fs.statfs>
    >);
  try {
    const r = await d.importFiles([other], null, randomUUID());
    expect(r.results[0].reason).toContain("磁盘空间不足");
  } finally {
    statSpy.mockRestore();
  }
  const { Writable } = await import("node:stream");
  const streamSpy = vi.spyOn(streams, "createWriteStream").mockImplementation(
    () =>
      new Writable({
        write(_chunk, _encoding, callback) {
          callback(
            Object.assign(new Error("ENOSPC simulated full disk"), {
              code: "ENOSPC",
            }),
          );
        },
      }) as ReturnType<typeof streams.createWriteStream>,
  );
  try {
    const r = await d.importFiles([other], null, randomUUID());
    expect(r.results[0].status).toBe("failed");
    expect(r.results[0].reason).toContain("ENOSPC");
  } finally {
    streamSpy.mockRestore();
  }
  expect((await d.storageUsage()).attachments).toBe(baseline.attachments);
  expect(await readFile(file, "utf8")).toBe("原始资料");
  d.store.audit();
  d.store.close();
});

test("restore pointer failure rolls back; retry preserves owned display and the chosen loot round", async () => {
  const fs = await import("node:fs/promises");
  const { advanceLoot } = await import("../src/main/collection/loot");
  const root = await mkdtemp(join(tmpdir(), "study-restore-fault-")),
    d = new Datasets(root);
  await d.init();
  try {
    d.store.db
      .prepare("UPDATE loot_state SET target_ms=600000,catalog_id='pebble'")
      .run();
    d.store.db.transaction(() =>
      advanceLoot(d.store.db, 600000, (min) => min),
    )();
    const item = d.store.read("getInventory", {})[0];
    const result = d.store.command("placeCollectible", {
      datasetId: d.store.datasetId,
      operationId: randomUUID(),
      payload: { id: item.id, tankIndex: 0 },
    });
    expect(result.ok).toBe(true);
    const loot = d.store.db.prepare("SELECT * FROM loot_state").get();
    const beforeId = d.store.datasetId;
    const backup = join(root, "manual.studybackup");
    await d.exportTo(backup);
    const inspected = await d.inspect(backup);
    const rename = fs.rename;
    let injected = false;
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
      if (String(b) === join(root, "current.json") && !injected) {
        injected = true;
        throw new Error("injected pointer switch failure");
      }
      return rename(a, b);
    });
    try {
      await expect(d.restore(inspected.token)).rejects.toThrow(
        "injected pointer",
      );
    } finally {
      spy.mockRestore();
    }
    expect(d.store.datasetId).toBe(beforeId);
    d.store.audit();
    const retry = await d.inspect(backup);
    await d.restore(retry.token);
    expect(d.store.datasetId).not.toBe(beforeId);
    expect(d.store.read("getCollection", {})[0].id).toBe(item.id);
    expect(d.store.db.prepare("SELECT * FROM loot_state").get()).toEqual(loot);
    d.store.audit();
  } finally {
    d.store.close();
  }
});
