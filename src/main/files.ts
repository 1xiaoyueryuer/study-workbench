import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
  realpath,
  stat,
  statfs,
  access,
  readdir,
  unlink,
} from "node:fs/promises";
import { join, basename, extname, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as yazl from "yazl";
import * as yauzl from "yauzl";
import { Store } from "./store";
import Database from "better-sqlite3";
import { DomainError, appearanceSchema, goalSchema } from "../shared/contracts";
export const shaFile = async (path: string) => {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest("hex");
};
export async function atomicJson(path: string, value: unknown) {
  const temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, path);
}
type Manifest = {
  format: 1;
  schema: number;
  createdAt: string;
  files: { path: string; size: number; sha256: string }[];
};
export class Datasets {
  store!: Store;
  dir = "";
  importController: AbortController | null = null;
  importProgress: {
    jobId: string;
    name: string;
    completed: number;
    total: number;
    bytes: number;
    active: boolean;
  } | null = null;
  private attachmentBusy = 0;
  private previewPins = new Map<string, number>();
  pinPreview(path: string) {
    const key = resolve(path);
    this.previewPins.set(key, (this.previewPins.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.previewPins.get(key) ?? 1) - 1;
      if (count) this.previewPins.set(key, count);
      else this.previewPins.delete(key);
    };
  }
  cancelImport(jobId: string) {
    if (this.importProgress?.jobId === jobId) this.importController?.abort();
    return null;
  }
  get budget() {
    const row = this.store.db
      .prepare("SELECT value FROM app_meta WHERE key='attachment_budget'")
      .get() as { value: string } | undefined;
    return Number(row?.value ?? 5 * 1024 ** 3);
  }
  tokens = new Map<string, { dir: string; manifest: Manifest }>();
  constructor(public root: string) {}
  async init() {
    await mkdir(join(this.root, "datasets"), { recursive: true });
    let current: any;
    try {
      current = JSON.parse(
        await readFile(join(this.root, "current.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      current = { id: randomUUID() };
      const dir = join(this.root, "datasets", current.id);
      await mkdir(join(dir, "attachments"), { recursive: true });
      const s = new Store(join(dir, "study.sqlite"));
      s.close();
      await atomicJson(join(this.root, "current.json"), current);
    }
    if (!/^[a-f0-9-]{36}$/.test(current.id))
      throw new Error("活动数据指针损坏");
    this.dir = join(this.root, "datasets", current.id);
    await access(join(this.dir, "study.sqlite"));
    await this.backupBeforeUpgrade();
    this.store = new Store(join(this.dir, "study.sqlite"));
    this.store.audit();
    await atomicJson(join(this.dir, "validated.json"), { valid: true });
    await this.cleanStorage();
    await this.checkAttachments();
    await this.deduplicate();
    await this.cleanupAttachments();
  }
  async backupBeforeUpgrade() {
    const db = new Database(join(this.dir, "study.sqlite"), { readonly: true });
    try {
      const version = db
        .prepare("SELECT MAX(version) n FROM schema_migrations")
        .get() as { n: number };
      if (version.n !== 1) return;
      const refs = db
        .prepare(
          "SELECT DISTINCT a.* FROM attachments a JOIN resources r ON r.attachment_id=a.id",
        )
        .all() as {
        relative_path: string;
        size_bytes: number;
        sha256: string;
      }[];
      const bytes =
        refs.reduce((s, r) => s + r.size_bytes, 0) +
        (await stat(join(this.dir, "study.sqlite"))).size;
      const disk = await statfs(this.dir);
      if (
        bytes > 1024 ** 3 ||
        Number(disk.bavail) * Number(disk.bsize) < bytes + 512 * 1024 ** 2
      )
        throw new Error(
          "升级前完整安全备份需要更多空间，请先用旧版本导出备份并调整资料占用（本次未修改原库）",
        );
      const parent = join(this.root, "backups");
      await mkdir(parent, { recursive: true });
      const destination = join(
        parent,
        `before-upgrade-${Date.now()}.studybackup`,
      );
      if (
        await access(destination).then(
          () => true,
          () => false,
        )
      )
        return;
      const temp = join(this.root, "staging", randomUUID());
      await mkdir(temp, { recursive: true });
      try {
        await db.backup(join(temp, "study.sqlite"));
        const files: Manifest["files"] = [
          {
            path: "study.sqlite",
            size: (await stat(join(temp, "study.sqlite"))).size,
            sha256: await shaFile(join(temp, "study.sqlite")),
          },
        ];
        for (const r of refs) {
          if (!/^attachments\/[a-f0-9-]{36}$/.test(r.relative_path))
            throw new Error("旧附件路径无效");
          const path = join(this.dir, r.relative_path),
            digest = await shaFile(path);
          if (digest !== r.sha256 || (await stat(path)).size !== r.size_bytes)
            throw new Error("旧附件完整性校验失败，升级已停止");
          files.push({
            path: r.relative_path,
            size: r.size_bytes,
            sha256: digest,
          });
        }
        const zip = new yazl.ZipFile();
        zip.addBuffer(
          Buffer.from(
            JSON.stringify({
              format: 1,
              schema: 1,
              createdAt: new Date().toISOString(),
              files,
            }),
          ),
          "manifest.json",
        );
        for (const f of files)
          zip.addFile(
            join(f.path === "study.sqlite" ? temp : this.dir, f.path),
            f.path,
          );
        const writing = pipeline(
          zip.outputStream,
          createWriteStream(destination + ".partial"),
        );
        zip.end();
        await writing;
        await rename(destination + ".partial", destination);
      } finally {
        await rm(temp, { recursive: true, force: true });
        await unlink(destination + ".partial").catch(() => {});
      }
    } finally {
      db.close();
    }
  }
  async checkAttachments() {
    for (const a of this.store.db
      .prepare("SELECT * FROM attachments")
      .all() as any[]) {
      const safe = /^attachments\/[a-f0-9-]{36}$/.test(a.relative_path);
      const found =
        safe &&
        (await access(join(this.dir, a.relative_path)).then(
          () => true,
          () => false,
        ));
      this.store.db
        .prepare("UPDATE attachments SET status=? WHERE id=?")
        .run(found ? "ok" : "missing", a.id);
    }
  }
  async cleanupAttachments() {
    if (this.attachmentBusy) return;
    // Only generated attachment paths inside this dataset are eligible for cleanup.
    const unused = this.store.db
      .prepare(
        "SELECT * FROM attachments WHERE id NOT IN (SELECT attachment_id FROM resources WHERE attachment_id IS NOT NULL)",
      )
      .all() as any[];
    for (const a of unused) {
      if (!/^attachments\/[a-f0-9-]{36}$/.test(a.relative_path)) continue;
      try {
        await unlink(join(this.dir, a.relative_path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      }
      this.store.db.prepare("DELETE FROM attachments WHERE id=?").run(a.id);
    }
    const files = await readdir(join(this.dir, "attachments"), {
      withFileTypes: true,
    });
    for (const file of files) {
      if (!file.isFile() || !/^[a-f0-9-]{36}(\.tmp)?$/.test(file.name))
        continue;
      const path = join(this.dir, "attachments", file.name);
      if (
        this.store.db
          .prepare("SELECT id FROM attachments WHERE relative_path=?")
          .get(`attachments/${file.name}`)
      )
        continue;
      // Import and cleanup are serialized. Orphans are never user source files.
      await unlink(path).catch(() => {});
    }
  }
  async deduplicate() {
    if (
      this.store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='attachment_content'",
        )
        .get()
    )
      return;
    const rows = this.store.db
      .prepare("SELECT * FROM attachments ORDER BY rowid")
      .all() as {
      id: string;
      relative_path: string;
      sha256: string;
      size_bytes: number;
      status: string;
    }[];
    const seen = new Map<string, string>();
    for (const a of rows) {
      if (a.status !== "ok") continue;
      const path = join(this.dir, a.relative_path),
        digest = await shaFile(path),
        size = (await stat(path)).size;
      const key = digest + ":" + size,
        prior = seen.get(key);
      this.store.db.transaction(() => {
        this.store.db
          .prepare("UPDATE attachments SET sha256=?,size_bytes=? WHERE id=?")
          .run(digest, size, a.id);
        if (prior)
          this.store.db
            .prepare(
              "UPDATE resources SET attachment_id=? WHERE attachment_id=?",
            )
            .run(prior, a.id);
      })();
      if (!prior) seen.set(key, a.id);
    }
    await this.cleanupAttachments();
    this.store.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS attachment_content ON attachments(sha256,size_bytes)",
    );
  }
  async importFiles(
    paths: string[],
    courseId: string | null,
    operationId: string,
  ) {
    if (paths.length > 100)
      throw new DomainError("INVALID_INPUT", "每批最多100个文件");
    const datasetId = this.store.datasetId,
      dir = this.dir;
    if (!courseId)
      courseId = (
        this.store.db
          .prepare("SELECT id FROM courses WHERE normalized_name='未归档'")
          .get() as { id: string }
      ).id;
    const fingerprint = JSON.stringify({ paths, courseId });
    const existing = this.store.db
      .prepare("SELECT * FROM command_results WHERE operation_id=?")
      .get(operationId) as
      { canonical_payload_hash: string; result_json: string } | undefined;
    if (existing) {
      if (existing.canonical_payload_hash !== fingerprint)
        throw new DomainError("OP_CONFLICT", "导入内容冲突");
      return JSON.parse(existing.result_json).value;
    }
    if (
      !this.store.db.prepare("SELECT id FROM courses WHERE id=?").get(courseId)
    )
      throw new DomainError("INVALID_INPUT", "课程不存在");
    const results: { name: string; status: string; reason?: string }[] = [];
    const controller = new AbortController();
    this.importController = controller;
    this.importProgress = {
      jobId: operationId,
      name: "",
      completed: 0,
      total: paths.length,
      bytes: 0,
      active: true,
    };
    this.attachmentBusy++;
    try {
      for (const path of paths) {
        const name = basename(path),
          id = randomUUID(),
          relative = `attachments/${id}`,
          temp = join(dir, relative + ".tmp");
        try {
          this.importProgress.name = name;
          this.importProgress.bytes = 0;
          if (controller.signal.aborted) {
            results.push({ name, status: "cancelled" });
            continue;
          }
          const progress = this.importProgress!;
          const info = await lstat(path);
          if (
            info.isSymbolicLink() ||
            !info.isFile() ||
            (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()
          )
            throw new Error("不支持文件夹或链接文件");
          if (
            !/\.(pdf|txt|md|docx?|pptx?|xlsx?|csv|png|jpe?g|webp|gif|bmp)$/i.test(
              name,
            )
          )
            throw new Error("不支持此格式");
          if (info.size > 1024 ** 3) throw new Error("单个文件不能超过1GiB");
          const disk = await statfs(dir);
          if (
            Number(disk.bavail) * Number(disk.bsize) <
            info.size + 512 * 1024 ** 2
          )
            throw new Error("磁盘空间不足，需保留512MiB");
          const h = createHash("sha256");
          let size = 0;
          await pipeline(
            createReadStream(path),
            new Transform({
              transform(chunk, _encoding, callback) {
                size += chunk.length;
                if (size > 1024 ** 3)
                  return callback(new Error("文件超过1GiB"));
                h.update(chunk);
                progress.bytes = size;
                callback(null, chunk);
              },
            }),
            createWriteStream(temp, { flags: "wx" }),
            { signal: controller.signal },
          );
          const sha = h.digest("hex");
          if (this.store.datasetId !== datasetId)
            throw new DomainError("STALE_DATASET", "数据集已更换");
          const prior = this.store.db
            .prepare(
              "SELECT * FROM attachments WHERE sha256=? AND size_bytes=?",
            )
            .get(sha, size) as
            { id: string; relative_path: string } | undefined;
          if (prior && (await shaFile(join(dir, prior.relative_path))) !== sha)
            throw new Error("已有附件损坏，请先恢复备份");
          if (
            prior &&
            this.store.db
              .prepare(
                "SELECT id FROM resources WHERE course_id=? AND attachment_id=?",
              )
              .get(courseId, prior.id)
          ) {
            results.push({ name, status: "duplicate" });
            continue;
          }
          const occupied = (
            this.store.db
              .prepare("SELECT COALESCE(SUM(size_bytes),0) n FROM attachments")
              .get() as { n: number }
          ).n;
          if (!prior && occupied + size > this.budget)
            throw new Error(
              `本批新增文件 ${Math.ceil(size / 1024 ** 2)} MiB 将超过资料预算，请在设置中调整预算后重试`,
            );
          if (!prior) await rename(temp, join(dir, relative));
          this.store.db
            .transaction(() => {
              if (
                !this.store.db
                  .prepare("SELECT id FROM courses WHERE id=?")
                  .get(courseId)
              )
                throw new Error("课程已移除");
              if (!prior)
                this.store.db
                  .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?)")
                  .run(
                    id,
                    relative,
                    name,
                    "application/octet-stream",
                    size,
                    sha,
                    "ok",
                  );
              this.store.db
                .prepare(
                  "INSERT INTO resources(id,title,course_id,kind,attachment_id,created_at,original_name) VALUES(?,?,?,'file',?,?,?)",
                )
                .run(
                  randomUUID(),
                  name,
                  courseId,
                  prior?.id ?? id,
                  new Date().toISOString(),
                  name,
                );
              this.store.bump();
            })
            .immediate();
          results.push({ name, status: "imported" });
        } catch (e) {
          results.push({
            name,
            status: controller.signal.aborted ? "cancelled" : "failed",
            reason: e instanceof Error ? e.message : String(e),
          });
        } finally {
          this.importProgress.completed++;
          await unlink(temp).catch(() => {});
        }
      }
      const result = {
        count: results.filter((r) => r.status === "imported").length,
        results,
      };
      this.store.db
        .prepare("INSERT INTO command_results VALUES(?,?,?,?,?)")
        .run(
          operationId,
          "chooseAndImportFiles",
          fingerprint,
          JSON.stringify({ ok: true, value: result }),
          new Date().toISOString(),
        );
      return result;
    } finally {
      this.attachmentBusy--;
      this.importProgress.active = false;
      this.importController = null;
    }
  }
  async exportTo(destination: string) {
    this.store.systemPause("备份已暂停学习，请在完成后手动继续");
    if (this.store.storage === "error") throw new Error(this.store.lastError);
    const temp = join(this.root, "staging", randomUUID());
    await mkdir(temp, { recursive: true });
    const controller = new AbortController();
    this.importController = controller;
    this.importProgress = {
      jobId: randomUUID(),
      name: "导出备份",
      completed: 0,
      total: 1,
      bytes: 0,
      active: true,
    };
    this.attachmentBusy++;
    try {
      const required =
        (
          this.store.db
            .prepare("SELECT COALESCE(SUM(size_bytes),0) n FROM attachments")
            .get() as { n: number }
        ).n + (await stat(join(this.dir, "study.sqlite"))).size;
      const disk = await statfs(dirname(resolve(destination)));
      if (
        Number(disk.bavail) * Number(disk.bsize) <
        required + Math.max(512 * 1024 ** 2, required * 0.1)
      )
        throw new Error("备份目标磁盘空间不足");
      await this.store.db.backup(join(temp, "study.sqlite"));
      const refs = this.store.db
        .prepare(
          "SELECT DISTINCT a.* FROM attachments a JOIN resources r ON r.attachment_id=a.id",
        )
        .all() as { relative_path: string }[];
      const files: Manifest["files"] = [];
      for (const path of [
        "study.sqlite",
        ...refs.map((a) => a.relative_path),
      ]) {
        if (controller.signal.aborted) throw new Error("备份已取消");
        const source = join(path === "study.sqlite" ? temp : this.dir, path);
        files.push({
          path,
          size: (await stat(source)).size,
          sha256: await shaFile(source),
        });
      }
      const manifest: Manifest = {
        format: 1,
        schema: 2,
        createdAt: new Date().toISOString(),
        files,
      };
      const zip = new yazl.ZipFile();
      zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json");
      for (const f of files)
        zip.addFile(
          join(f.path === "study.sqlite" ? temp : this.dir, f.path),
          f.path,
        );
      const promise = pipeline(
        zip.outputStream,
        new Transform({
          transform: (chunk, _encoding, cb) => {
            this.importProgress!.bytes += chunk.length;
            cb(null, chunk);
          },
        }),
        createWriteStream(destination + ".partial"),
        { signal: controller.signal },
      );
      zip.end();
      await promise;
      await rename(destination + ".partial", destination);
      return { path: destination, files: files.length };
    } finally {
      this.attachmentBusy--;
      this.importProgress.active = false;
      this.importController = null;
      await rm(temp, { recursive: true, force: true });
      await unlink(destination + ".partial").catch(() => {});
    }
  }
  async inspect(path: string) {
    const target = join(this.root, "staging", randomUUID());
    await mkdir(target, { recursive: true });
    const controller = new AbortController();
    this.importController = controller;
    this.importProgress = {
      jobId: randomUUID(),
      name: "检查备份",
      completed: 0,
      total: 1,
      bytes: 0,
      active: true,
    };
    try {
      const disk = await statfs(target);
      const maxBytes = Math.min(
        64 * 1024 ** 3,
        (Number(disk.bavail) * Number(disk.bsize)) / 2,
      );
      let total = 0,
        count = 0;
      const names = new Set<string>();
      await new Promise<void>((done, reject) => {
        yauzl.open(
          path,
          { lazyEntries: true, validateEntrySizes: true },
          (err, zip) => {
            if (err || !zip) {
              reject(err);
              return;
            }
            let stopped = false;
            const stop = (e: unknown) => {
              if (stopped) return;
              stopped = true;
              zip.close();
              reject(e);
            };
            controller.signal.addEventListener(
              "abort",
              () => stop(new Error("检查已取消")),
              { once: true },
            );
            if (controller.signal.aborted) {
              stop(new Error("检查已取消"));
              return;
            }
            zip.on("error", stop);
            zip.on("end", () => done());
            zip.on("entry", (e: yauzl.Entry) => {
              void (async () => {
                if (++count > 10000) throw new Error("备份条目过多");
                const n = e.fileName;
                if (
                  !/^(manifest\.json|study\.sqlite|attachments\/[a-f0-9-]{36})$/.test(
                    n,
                  ) ||
                  names.has(n) ||
                  ((e.externalFileAttributes >>> 16) & 0xf000) === 0xa000
                )
                  throw new Error("备份包含非法路径或链接");
                names.add(n);
                total += e.uncompressedSize;
                if (total > maxBytes || e.uncompressedSize > 1024 ** 3)
                  throw new Error("备份过大或可用空间不足");
                if (n === "manifest.json" && e.uncompressedSize > 4 * 1024 ** 2)
                  throw new Error("清单过大");
                await mkdir(join(target, "attachments"), { recursive: true });
                await new Promise<void>((res, rej) =>
                  zip.openReadStream(e, (error, stream) => {
                    if (error || !stream) {
                      rej(error);
                      return;
                    }
                    pipeline(
                      stream,
                      new Transform({
                        transform: (chunk, _encoding, cb) => {
                          this.importProgress!.bytes += chunk.length;
                          cb(null, chunk);
                        },
                      }),
                      createWriteStream(join(target, n), { flags: "wx" }),
                      { signal: controller.signal },
                    ).then(() => res(), rej);
                  }),
                );
                zip.readEntry();
              })().catch(stop);
            });
            zip.readEntry();
          },
        );
      });
      const m = JSON.parse(
        await readFile(join(target, "manifest.json"), "utf8"),
      ) as Manifest;
      if (
        m.format !== 1 ||
        ![1, 2].includes(m.schema) ||
        !Array.isArray(m.files)
      )
        throw new DomainError("UNSUPPORTED_BACKUP", "不支持此备份版本");
      if (
        m.files.length !== names.size - 1 ||
        new Set(m.files.map((f) => f.path)).size !== m.files.length
      )
        throw new Error("备份清单不匹配");
      for (const f of m.files) {
        if (
          !names.has(f.path) ||
          f.path === "manifest.json" ||
          (await stat(join(target, f.path))).size !== f.size ||
          (await shaFile(join(target, f.path))) !== f.sha256
        )
          throw new Error("备份哈希校验失败");
      }
      const s = new Store(join(target, "study.sqlite"), undefined, false);
      let summary: any;
      try {
        s.audit();
        const settings = s.read("getSettings", {});
        appearanceSchema.parse(settings.appearance);
        goalSchema.parse(settings.goal);
        for (const a of s.db
          .prepare(
            "SELECT DISTINCT a.* FROM attachments a JOIN resources r ON r.attachment_id=a.id",
          )
          .all() as any[]) {
          const file = m.files.find((f) => f.path === a.relative_path);
          if (!file || file.sha256 !== a.sha256 || file.size !== a.size_bytes)
            throw new Error("附件内容不一致");
        }
        summary = {
          earnedMs: s.totals().earned,
          sessionCount: (
            s.db.prepare("SELECT COUNT(*) n FROM study_sessions").get() as any
          ).n,
          resourceCount: (
            s.db.prepare("SELECT COUNT(*) n FROM resources").get() as any
          ).n,
        };
      } finally {
        s.close();
      }
      const token = randomUUID();
      for (const old of this.tokens.values())
        await rm(old.dir, { recursive: true, force: true });
      this.tokens.clear();
      this.tokens.set(token, { dir: target, manifest: m });
      return { token, ...summary, createdAt: m.createdAt };
    } catch (e) {
      await rm(target, { recursive: true, force: true });
      throw e;
    } finally {
      this.importProgress.active = false;
      this.importController = null;
    }
  }
  async restore(token: string) {
    const inspected = this.tokens.get(token);
    if (!inspected) throw new Error("检查令牌已失效，请重新选择备份");
    this.store.systemPause("正在恢复备份");
    if (this.store.storage === "error") throw new Error(this.store.lastError);
    await mkdir(join(this.root, "backups"), { recursive: true });
    await this.exportTo(
      join(this.root, "backups", `before-restore-${Date.now()}.studybackup`),
    );
    const generation = randomUUID();
    const destination = join(this.root, "datasets", generation);
    await rename(inspected.dir, destination);
    const candidate = new Store(join(destination, "study.sqlite"));
    candidate.db
      .prepare("UPDATE app_meta SET value=? WHERE key='dataset_id'")
      .run(randomUUID());

    try {
      candidate.audit();
      await atomicJson(join(destination, "validated.json"), { valid: true });
    } finally {
      candidate.close();
    }
    const oldDir = this.dir;
    await atomicJson(join(this.root, "restore-journal.json"), {
      old: basename(oldDir),
      next: generation,
      state: "prepared",
    });
    this.store.close();
    try {
      await atomicJson(join(this.root, "current.json"), { id: generation });
      this.store = new Store(join(destination, "study.sqlite"));
      this.dir = destination;
      await atomicJson(join(this.root, "restore-journal.json"), {
        old: basename(oldDir),
        next: generation,
        state: "complete",
      });
    } catch (e) {
      await atomicJson(join(this.root, "current.json"), {
        id: basename(oldDir),
      });
      this.dir = oldDir;
      this.store = new Store(join(oldDir, "study.sqlite"));
      throw e;
    }
    this.tokens.clear();
    await this.deduplicate();
    await this.trimBackups();
    return { datasetId: this.store.datasetId };
  }
  async trimCache(reserve = 0) {
    const parent = resolve(this.root, "view-cache");
    const rows = [];
    for (const f of await readdir(parent, { withFileTypes: true }).catch(
      () => [],
    )) {
      if (
        !f.isDirectory() ||
        f.isSymbolicLink() ||
        !/^[a-f0-9-]{36}$/.test(f.name)
      )
        continue;
      const dir = join(parent, f.name);
      let bytes = 0;
      for (const child of await readdir(dir, { withFileTypes: true }))
        if (child.isFile() && !child.isSymbolicLink())
          bytes += (await stat(join(dir, child.name))).size;
      rows.push({ dir, bytes, time: (await stat(dir)).mtimeMs });
    }
    let total = rows.reduce((n, r) => n + r.bytes, 0);
    for (const r of rows.sort((a, b) => a.time - b.time)) {
      if (total + reserve <= 256 * 1024 ** 2) break;
      if (this.previewPins.has(resolve(r.dir))) continue;
      await rm(r.dir, { recursive: true, force: true });
      total -= r.bytes;
    }
    if (total + reserve > 256 * 1024 ** 2)
      throw new Error(
        "预览缓存空间不足，请关闭已打开的资料后重试（单文件预览上限256MiB）",
      );
  }
  async trimBackups() {
    const parent = join(this.root, "backups"),
      rows = [];
    for (const f of await readdir(parent, { withFileTypes: true }).catch(
      () => [],
    ))
      if (
        f.isFile() &&
        !f.isSymbolicLink() &&
        /^before-(restore-\d+|upgrade-(?:[a-f0-9-]{36}|\d+))\.studybackup$/.test(
          f.name,
        )
      ) {
        const info = await stat(join(parent, f.name));
        rows.push({
          path: join(parent, f.name),
          size: info.size,
          time: info.mtimeMs,
        });
      }
    rows.sort((a, b) => b.time - a.time);
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      total += rows[i].size;
      if (i > 0 && (i >= 2 || total > 1024 ** 3)) await unlink(rows[i].path);
    }
    const journal = (await readFile(
      join(this.root, "restore-journal.json"),
      "utf8",
    ).then(JSON.parse, () => null)) as {
      state: string;
      old: string;
      next: string;
    } | null;
    if (journal?.state !== "complete") return;
    const datasets = resolve(this.root, "datasets");
    for (const f of await readdir(datasets, { withFileTypes: true })) {
      if (
        !f.isDirectory() ||
        f.isSymbolicLink() ||
        !/^[a-f0-9-]{36}$/.test(f.name) ||
        f.name === basename(this.dir) ||
        f.name === journal.next
      )
        continue;
      const path = resolve(datasets, f.name);
      if (
        !(await access(join(path, "validated.json")).then(
          () => true,
          () => false,
        ))
      )
        continue;
      if (
        f.name === journal.old &&
        Date.now() - (await stat(path)).mtimeMs < 7 * 86400000
      )
        continue;
      await rm(path, { recursive: true, force: true });
    }
  }
  async storageUsage() {
    const scan = async (path: string): Promise<number> => {
      let sum = 0;
      for (const f of await readdir(path, { withFileTypes: true }).catch(
        () => [],
      )) {
        if (f.isSymbolicLink()) continue;
        const p = join(path, f.name);
        sum += f.isDirectory() ? await scan(p) : (await stat(p)).size;
      }
      return sum;
    };
    const attachments = await scan(join(this.dir, "attachments"));
    let reclaimable = 0;
    for (const f of await readdir(join(this.root, "view-cache"), {
      withFileTypes: true,
    }).catch(() => [])) {
      const dir = join(this.root, "view-cache", f.name);
      if (
        f.isDirectory() &&
        !f.isSymbolicLink() &&
        !this.previewPins.has(resolve(dir))
      )
        reclaimable += await scan(dir);
    }
    const cache = await scan(join(this.root, "view-cache")),
      temporary = await scan(join(this.root, "staging")),
      backups = await scan(join(this.root, "backups"));
    let database = 0;
    for (const name of await readdir(this.dir))
      if (name.startsWith("study.sqlite"))
        database += (await stat(join(this.dir, name))).size;
    return {
      attachments,
      database,
      cache,
      temporary,
      backups,
      oldDatasets: Math.max(
        0,
        (await scan(join(this.root, "datasets"))) - attachments - database,
      ),
      reclaimable,
      budget: this.budget,
    };
  }
  async cleanStorage(manual = false) {
    // Only generated children of controlled roots; junctions/symlinks are never followed.
    await this.trimCache();
    await this.trimBackups();
    for (const name of ["staging", "view-cache"]) {
      const parent = resolve(this.root, name);
      const entries = await readdir(parent, { withFileTypes: true }).catch(
        () => [],
      );
      for (const f of entries) {
        const path = resolve(parent, f.name);
        if (
          !path.startsWith(parent + "\\") ||
          this.previewPins.has(path) ||
          f.isSymbolicLink() ||
          [...this.tokens.values()].some((t) => resolve(t.dir) === path)
        )
          continue;
        const info = await lstat(path);
        if (
          !(manual && name === "view-cache") &&
          Date.now() - info.mtimeMs < 24 * 60 * 60 * 1000
        )
          continue;
        await rm(path, { recursive: true, force: true }).catch(() => {});
      }
    }
    await this.cleanupAttachments();
    return this.storageUsage();
  }
  resource(id: string) {
    const r = this.store.db
      .prepare(
        "SELECT r.*,a.relative_path FROM resources r LEFT JOIN attachments a ON a.id=r.attachment_id WHERE r.id=?",
      )
      .get(id) as any;
    if (!r) throw new Error("资料不存在");
    if (r.kind === "file") {
      if (!/^attachments\/[a-f0-9-]{36}$/.test(r.relative_path))
        throw new Error("附件路径非法");
      r.path = resolve(this.dir, r.relative_path);
      r.extension = extname(r.original_name).toLowerCase();
    }
    return r;
  }
}
