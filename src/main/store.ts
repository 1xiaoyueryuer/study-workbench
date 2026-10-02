import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  defaults,
  DomainError,
  MAX_MS,
  readMethods,
  schemas,
  type Envelope,
  type Method,
  type Result,
  type Snapshot,
} from "../shared/contracts";
import { migration } from "./schema";
import { migration2 } from "./migrations/002";
import { initializeLoot, advanceLoot } from "./collection/loot";
import {
  economyRead,
  economyMutate,
  auditEconomy,
  type EconomySnapshot,
} from "./economy/economy";
import { StudyClock, localDate } from "./time";
const now = () => new Date().toISOString();
export const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const canonical = (o: any): string => JSON.stringify(o, Object.keys(o).sort());
export class Store {
  db: Database.Database;
  clock: StudyClock;
  epoch = randomUUID();
  seq = 0;
  storage: "ok" | "saving" | "error" = "ok";
  session: any = null;
  lastError = "";
  private snapshotCache: {
    revision: number;
    totals: ReturnType<Store["totals"]>;
    economy: EconomySnapshot;
  } | null = null;
  constructor(path: string, clock = new StudyClock(), recover = true) {
    this.clock = clock;
    this.db = new Database(path);
    this.db.pragma("foreign_keys=ON");
    this.db.pragma("journal_mode=WAL");
    this.db.pragma("synchronous=FULL");
    this.db.pragma("busy_timeout=500");
    try {
      const exists = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='schema_migrations'",
        )
        .get();
      if (!exists)
        this.db.transaction(() => {
          this.db.exec(migration);
          this.db
            .prepare("INSERT INTO schema_migrations VALUES(1,?,?)")
            .run(hash(migration), now());
          for (const [k, v] of Object.entries({
            dataset_id: randomUUID(),
            revision: "0",
            schema_version: "1",
          }))
            this.db.prepare("INSERT INTO app_meta VALUES(?,?)").run(k, v);
          for (const [k, v] of Object.entries(defaults))
            this.db
              .prepare("INSERT INTO settings VALUES(?,1,?)")
              .run(k, JSON.stringify(v));
        })();
      const versions = this.db
        .prepare(
          "SELECT version,checksum FROM schema_migrations ORDER BY version",
        )
        .all() as { version: number; checksum: string }[];
      if (
        versions.length < 1 ||
        versions.length > 2 ||
        versions.some(
          (v, i) =>
            v.version !== i + 1 ||
            v.checksum !== hash([migration, migration2][i]),
        )
      ) {
        this.db.close();
        throw new DomainError(
          "UNSUPPORTED_BACKUP",
          "数据库版本或迁移校验不支持",
        );
      }
      if (exists && versions.length === 1 && path !== ":memory:") {
        const safety = path + ".before-v2";
        if (!existsSync(safety)) this.db.prepare("VACUUM INTO ?").run(safety);
      }
      if (versions.length === 1)
        this.db
          .transaction(() => {
            const before = this.totals();
            this.db.exec(migration2);
            if (JSON.stringify(before) !== JSON.stringify(this.totals()))
              throw new Error("迁移账本金额不一致");
            this.db
              .prepare("INSERT INTO schema_migrations VALUES(2,?,?)")
              .run(hash(migration2), now());
            this.db
              .prepare(
                "UPDATE app_meta SET value='2' WHERE key='schema_version'",
              )
              .run();
          })
          .immediate();
      this.db.transaction(() => initializeLoot(this.db))();
      if (!exists)
        this.db
          .prepare(
            "UPDATE app_meta SET value='0' WHERE key='economy_migration_notice'",
          )
          .run();
      if (recover)
        this.db
          .prepare(
            "UPDATE study_sessions SET state='recovery_pending',pause_reason='上次未正常结束，仅恢复最近成功保存的时间' WHERE state!='ended'",
          )
          .run();
      this.reload();
      this.clock.reset(this.session?.credited_ms ?? 0);
    } catch (error) {
      if (this.db.open) this.db.close();
      throw error;
    }
  }
  get datasetId() {
    return (
      this.db
        .prepare("SELECT value FROM app_meta WHERE key='dataset_id'")
        .get() as any
    ).value as string;
  }
  get revision() {
    return Number(
      (
        this.db
          .prepare("SELECT value FROM app_meta WHERE key='revision'")
          .get() as any
      ).value,
    );
  }
  reload() {
    this.session =
      this.db
        .prepare("SELECT * FROM study_sessions WHERE state!='ended'")
        .get() ?? null;
  }
  totals() {
    const r = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_ms),0) balance,COALESCE(SUM(CASE WHEN kind='study' THEN amount_ms ELSE 0 END),0) earned FROM time_entries",
      )
      .get() as any;
    if (!Number.isSafeInteger(r.earned) || r.earned > MAX_MS || r.balance < 0)
      throw new Error("账本金额超出安全范围");
    return r;
  }
  snapshot(): Snapshot {
    const revision = this.revision;
    if (this.snapshotCache?.revision !== revision)
      this.snapshotCache = {
        revision,
        totals: this.totals(),
        economy: economyRead(this.db, "snapshot", {}),
      };
    const t = this.snapshotCache.totals;
    return {
      protocolVersion: 1,
      datasetId: this.datasetId,
      processEpoch: this.epoch,
      snapshotSeq: ++this.seq,
      dbRevision: this.revision,
      emittedAtUtc: now(),
      phase: this.session
        ? this.clock.running
          ? "running"
          : this.session.state === "recovery_pending"
            ? "recovery_pending"
            : "paused"
        : "idle",
      pauseReasons:
        this.session && !this.clock.running
          ? [this.lastError || this.clock.reason || this.session.pause_reason]
          : [],
      storage: this.storage,
      session: this.session
        ? {
            id: this.session.id,
            targetMs: this.session.target_ms,
            effectiveMs: this.clock.ms,
            committedMs: this.session.credited_ms,
          }
        : null,
      ...this.snapshotCache.economy,
      earnedMs: t.earned,
      balanceMs: t.balance,
      todayMs:
        Number(
          (
            this.db
              .prepare(
                "SELECT COALESCE(SUM(amount_ms),0) ms FROM study_day_slices WHERE local_date=?",
              )
              .get(localDate(Date.now())) as any
          ).ms,
        ) +
        this.clock.slices
          .filter((s) => s.date === localDate(Date.now()))
          .reduce((total, s) => total + s.ms, 0),
      pendingMs: this.session
        ? Math.max(0, this.clock.ms - this.session.credited_ms)
        : 0,
      lastCheckpointAt: this.session?.checkpoint_at ?? null,
    };
  }
  settle() {
    if (!this.session) return;
    const row = this.db
      .prepare("SELECT credited_ms FROM study_sessions WHERE id=?")
      .get(this.session.id) as any;
    const delta = this.clock.ms - row.credited_ms;
    if (delta <= 0) return;
    if (this.totals().earned + delta > MAX_MS)
      fail("INVALID_INPUT", "累计时间达到安全上限");
    const prior = this.db
      .prepare(
        "SELECT id FROM time_entries WHERE session_id=? AND kind='study'",
      )
      .get(this.session.id) as { id: string } | undefined;
    const entry = prior?.id ?? randomUUID();
    this.db
      .prepare(
        "INSERT INTO time_entries(id,kind,amount_ms,session_id,session_total_after_ms,created_at) VALUES(?,'study',?,?,?,?) ON CONFLICT(session_id) WHERE kind='study' DO UPDATE SET amount_ms=amount_ms+excluded.amount_ms,session_total_after_ms=excluded.session_total_after_ms",
      )
      .run(entry, delta, this.session.id, this.clock.ms, now());
    if (this.clock.slices.reduce((s, v) => s + v.ms, 0) !== delta)
      throw new Error("日期切片与收入不一致");
    for (const s of this.clock.slices)
      this.db
        .prepare(
          "INSERT INTO study_day_slices(entry_id,local_date,amount_ms) VALUES(?,?,?) ON CONFLICT(entry_id,local_date,timezone) DO UPDATE SET amount_ms=amount_ms+excluded.amount_ms",
        )
        .run(entry, s.date, s.ms);
    advanceLoot(this.db, delta);
    this.db
      .prepare(
        "UPDATE study_sessions SET credited_ms=?,checkpoint_at=? WHERE id=?",
      )
      .run(this.clock.ms, now(), this.session.id);
  }
  committed() {
    this.clock.slices = [];
    this.clock.clockJumps = 0;
    this.reload();
    this.storage = "ok";
    this.lastError = "";
  }
  bump() {
    if (this.clock.clockJumps)
      this.db
        .prepare("INSERT INTO clock_events(created_at,note) VALUES(?,?)")
        .run(
          now(),
          `检测到 ${this.clock.clockJumps} 次系统时间跳变；时长仍由单调时钟计算`,
        );
    this.db
      .prepare(
        "UPDATE app_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
      )
      .run();
  }
  freezeError(e: unknown) {
    this.clock.running = false;
    this.storage = "error";
    this.lastError = `保存失败，计时已冻结：${e instanceof Error ? e.message : String(e)}`;
  }
  checkpoint() {
    if (!this.session || this.storage === "error") return;
    this.clock.sample();
    try {
      this.db
        .transaction(() => {
          this.settle();
          if (!this.clock.running)
            this.db
              .prepare(
                "UPDATE study_sessions SET state='paused',pause_reason=? WHERE id=?",
              )
              .run(this.clock.reason, this.session.id);
          this.bump();
        })
        .immediate();
      this.committed();
    } catch (e) {
      this.freezeError(e);
    }
  }
  systemPause(reason: string) {
    if (!this.session) return;
    this.clock.pause(reason);
    this.checkpoint();
  }
  command(method: Method, request: Envelope): Result<any> {
    try {
      if (
        !request ||
        (request.datasetId !== this.datasetId &&
          !(method === "getSnapshot" && request.datasetId === ""))
      )
        fail("STALE_DATASET", "数据集已变化，请刷新后重试");
      if (!/^[0-9a-f-]{36}$/i.test(request.operationId))
        fail("INVALID_INPUT", "操作标识无效");
      const parsed = schemas[method].safeParse(request.payload);
      if (!parsed.success)
        fail(
          "INVALID_INPUT",
          parsed.error.issues.map((v) => v.message).join("；"),
        );
      const p = parsed.data as any;
      if (readMethods.includes(method))
        return { ok: true, value: this.read(method, p) };
      const fingerprint = hash(canonical(p));
      const old = this.db
        .prepare("SELECT * FROM command_results WHERE operation_id=?")
        .get(request.operationId) as any;
      if (old) {
        if (old.kind !== method || old.canonical_payload_hash !== fingerprint)
          fail("OP_CONFLICT", "同一操作标识的内容不同");
        return JSON.parse(old.result_json);
      }
      if (this.storage === "error" && method !== "retrySave")
        throw new DomainError("STORAGE_UNAVAILABLE", this.lastError, true);
      this.clock.sample();
      let outcome: Result<any>;
      try {
        outcome = this.db
          .transaction(() => {
            this.settle();
            let result: Result<any>;
            try {
              result = {
                ok: true,
                value: this.db
                  .transaction(() => this.mutate(method, p))
                  .immediate(),
              };
            } catch (e) {
              if (!(e instanceof DomainError)) throw e;
              result = {
                ok: false,
                error: {
                  code: e.code,
                  message: e.message,
                  retryable: e.retryable,
                },
              };
            }
            const resuming =
              result.ok &&
              (method === "resumeStudy" ||
                (method === "resolveRecovery" && p.action === "resume"));
            if (this.session && !this.clock.running && !resuming)
              this.db
                .prepare(
                  "UPDATE study_sessions SET state=CASE WHEN state='running' THEN 'paused' ELSE state END,pause_reason=? WHERE id=?",
                )
                .run(this.clock.reason, this.session.id);
            this.db
              .prepare("INSERT INTO command_results VALUES(?,?,?,?,?)")
              .run(
                request.operationId,
                method,
                fingerprint,
                JSON.stringify(result),
                now(),
              );
            this.bump();
            return result;
          })
          .immediate();
        this.committed();
      } catch (e) {
        this.freezeError(e);
        throw new DomainError("STORAGE_UNAVAILABLE", this.lastError, true);
      }
      if (outcome.ok) {
        if (method === "startStudy") {
          this.clock.reset();
          this.clock.resume();
        }
        if (
          method === "resumeStudy" ||
          (method === "resolveRecovery" && p.action === "resume")
        )
          this.clock.resume();
        if (!this.session) this.clock.reset();
      }
      return outcome;
    } catch (e) {
      return {
        ok: false,
        error: {
          code: e instanceof DomainError ? e.code : "INVALID_INPUT",
          message: e instanceof Error ? e.message : String(e),
          retryable: e instanceof DomainError && e.retryable,
        },
      };
    }
  }
  read(method: Method, p: any): any {
    const economy = economyRead(this.db, method, p);
    if (economy !== undefined) return economy;
    switch (method) {
      case "getUnseenLoot": {
        const seen = Number(
          (
            this.db
              .prepare("SELECT value FROM app_meta WHERE key='loot_seen'")
              .get() as { value: string }
          ).value,
        );
        const count = (
          this.db
            .prepare("SELECT COUNT(*) n FROM loot_events WHERE sequence>?")
            .get(seen) as { n: number }
        ).n;
        const latest = this.db
          .prepare(
            "SELECT e.sequence,i.catalog_id,i.rarity_snapshot FROM loot_events e JOIN collectible_instances i ON i.id=e.instance_id WHERE e.sequence>? ORDER BY e.sequence DESC LIMIT 1",
          )
          .get(seen);
        return { count, latest };
      }
      case "getSnapshot":
        return this.snapshot();
      case "getSettings":
        return Object.fromEntries(
          (
            this.db
              .prepare("SELECT key,value_json FROM settings")
              .all() as any[]
          ).map((r) => [r.key, JSON.parse(r.value_json)]),
        );
      case "listSessions":
        return this.db
          .prepare(
            "SELECT * FROM study_sessions ORDER BY rowid DESC LIMIT 50 OFFSET ?",
          )
          .all(p.offset);
      case "getSession":
        return this.db
          .prepare("SELECT * FROM study_sessions WHERE id=?")
          .get(p.id);
      case "getDailySummary":
        return {
          days: this.db
            .prepare(
              "SELECT local_date,SUM(amount_ms) ms FROM study_day_slices GROUP BY local_date ORDER BY local_date DESC LIMIT 90",
            )
            .all(),
          reviews: this.db
            .prepare(
              "SELECT * FROM daily_reviews ORDER BY local_date DESC LIMIT 90",
            )
            .all(),
          clockEvents: this.db
            .prepare("SELECT * FROM clock_events ORDER BY id DESC LIMIT 20")
            .all(),
        };
      case "listRewards":
        return this.db
          .prepare(
            "SELECT * FROM rewards WHERE archived_at IS NULL ORDER BY rowid DESC",
          )
          .all();
      case "listRedemptions":
        return this.db
          .prepare(
            "SELECT * FROM redemptions ORDER BY rowid DESC LIMIT 50 OFFSET ?",
          )
          .all(p.offset);
      case "getRedemptionIntent":
        return (
          this.db
            .prepare(
              "SELECT * FROM redemption_intents WHERE state='pending' ORDER BY rowid DESC LIMIT 1",
            )
            .get() ?? null
        );
      case "listCourses":
        return this.db
          .prepare(
            "SELECT c.*,(SELECT COUNT(*) FROM resources r WHERE r.course_id=c.id) resource_count FROM courses c ORDER BY sort_order,name",
          )
          .all();
      case "listResources":
        return this.db
          .prepare(
            "SELECT r.*,c.name course_name,a.status FROM resources r LEFT JOIN attachments a ON a.id=r.attachment_id LEFT JOIN courses c ON c.id=r.course_id WHERE instr(lower(r.title || ' ' || r.note || ' ' || COALESCE(c.name,'')),lower(?))>0 AND (? IS NULL OR (?='uncategorized' AND r.course_id IS NULL) OR r.course_id=?) ORDER BY r.rowid DESC LIMIT 50 OFFSET ?",
          )
          .all(
            p.search ?? "",
            p.course ?? null,
            p.course ?? null,
            p.course ?? null,
            p.offset,
          );
      default:
        fail("INVALID_INPUT", "此操作需要桌面服务");
    }
  }
  mutate(method: Method, p: any): any {
    const economy = economyMutate(
      this.db,
      method,
      p,
      () => this.totals().balance,
    );
    if (economy !== undefined) return economy;
    switch (method) {
      case "startStudy": {
        if (this.session) fail("ACTIVE_SESSION", "已有学习，请先结束当前会话");
        const id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO study_sessions(id,state,target_ms,started_at) VALUES(?,'running',?,?)",
          )
          .run(id, p.targetMs, now());
        return { id };
      }
      case "pauseStudy": {
        if (!this.session) fail("INVALID_INPUT", "没有进行中的学习");
        this.clock.running = false;
        this.clock.reason = "手动暂停";
        return null;
      }
      case "resumeStudy":
      case "resolveRecovery": {
        if (!this.session) fail("INVALID_INPUT", "没有待恢复的学习");
        if (method === "resolveRecovery" && p.action === "end")
          return this.finish(this.session.id);
        this.db
          .prepare(
            "UPDATE study_sessions SET state='running',pause_reason='' WHERE id=?",
          )
          .run(this.session.id);
        return null;
      }
      case "endStudy":
        return this.finish(p.sessionId);
      case "retrySave":
        return null;
      case "setSessionNote":
        this.db
          .prepare("UPDATE study_sessions SET note=? WHERE id=?")
          .run(p.note, p.id);
        return null;
      case "setDailyReview":
        this.db
          .prepare(
            "INSERT INTO daily_reviews VALUES(?,?) ON CONFLICT(local_date) DO UPDATE SET note=excluded.note",
          )
          .run(p.date, p.note);
        return null;
      case "createCourse": {
        const id = randomUUID();
        if (
          this.db
            .prepare("SELECT id FROM courses WHERE normalized_name=?")
            .get(p.name.normalize("NFKC").toLowerCase())
        )
          fail("INVALID_INPUT", "课程名称已存在");
        this.db
          .prepare("INSERT INTO courses(id,name,normalized_name) VALUES(?,?,?)")
          .run(id, p.name, p.name.normalize("NFKC").toLowerCase());
        return { id };
      }
      case "renameCourse":
        if (
          this.db
            .prepare("SELECT id FROM courses WHERE normalized_name=? AND id!=?")
            .get(p.name.normalize("NFKC").toLowerCase(), p.id)
        )
          fail("INVALID_INPUT", "课程名称已存在");
        if (
          (
            this.db
              .prepare("SELECT normalized_name FROM courses WHERE id=?")
              .get(p.id) as { normalized_name: string } | undefined
          )?.normalized_name === "未归档"
        )
          fail("INVALID_INPUT", "未归档课程不能重命名");
        this.db
          .prepare("UPDATE courses SET name=?,normalized_name=? WHERE id=?")
          .run(p.name, p.name.normalize("NFKC").toLowerCase(), p.id);
        return null;
      case "renameResource":
        this.db
          .prepare("UPDATE resources SET title=? WHERE id=?")
          .run(p.title, p.id);
        return null;
      case "moveResource":
        if (
          !this.db.prepare("SELECT id FROM courses WHERE id=?").get(p.courseId)
        )
          fail("INVALID_INPUT", "课程不存在");
        this.db
          .prepare("UPDATE resources SET course_id=? WHERE id=?")
          .run(p.courseId, p.id);
        return null;
      case "deleteCourse": {
        const unfiled = this.db
          .prepare("SELECT id FROM courses WHERE normalized_name='未归档'")
          .get() as { id: string };
        if (p.id === unfiled.id) fail("INVALID_INPUT", "未归档课程不能删除");
        if (p.removeResources)
          this.db.prepare("DELETE FROM resources WHERE course_id=?").run(p.id);
        else
          this.db
            .prepare("UPDATE resources SET course_id=? WHERE course_id=?")
            .run(unfiled.id, p.id);
        this.db.prepare("DELETE FROM courses WHERE id=?").run(p.id);
        return null;
      }
      case "setStorageBudget":
        this.db
          .prepare(
            "INSERT INTO app_meta VALUES('attachment_budget',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(String(p.bytes));
        return null;
      case "acknowledgeLoot":
        this.db
          .prepare(
            "UPDATE app_meta SET value=MAX(CAST(value AS INTEGER),MIN(?,(SELECT COALESCE(MAX(sequence),0) FROM loot_events))) WHERE key='loot_seen'",
          )
          .run(p.sequence);
        return null;
      case "dismissMigrationNotice":
        this.db
          .prepare(
            "UPDATE app_meta SET value='0' WHERE key='economy_migration_notice'",
          )
          .run();
        return null;
      case "saveLink": {
        if (
          p.courseId &&
          !this.db.prepare("SELECT id FROM courses WHERE id=?").get(p.courseId)
        )
          fail("INVALID_INPUT", "课程不存在");
        const id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO resources(id,title,course_id,kind,url,note,created_at) VALUES(?,?,?,'url',?,?,?)",
          )
          .run(
            id,
            p.title,
            p.courseId ??
              (
                this.db
                  .prepare(
                    "SELECT id FROM courses WHERE normalized_name='未归档'",
                  )
                  .get() as { id: string }
              ).id,
            p.url,
            p.note,
            now(),
          );
        return { id };
      }
      case "deleteResource":
        this.db.prepare("DELETE FROM resources WHERE id=?").run(p.id);
        return null;
      case "updateGoal":
      case "updateAppearance":
        this.db
          .prepare(
            "UPDATE settings SET value_json=?,version=version+1 WHERE key=?",
          )
          .run(
            JSON.stringify(p),
            method === "updateGoal" ? "goal" : "appearance",
          );
        return null;
      default:
        fail("INVALID_INPUT", "未知操作");
    }
  }
  finish(id: string) {
    const row = this.db
      .prepare("SELECT * FROM study_sessions WHERE id=?")
      .get(id) as any;
    if (!row) fail("INVALID_INPUT", "学习记录不存在");
    if (row.state === "ended") return row;
    this.clock.running = false;
    this.db
      .prepare("UPDATE study_sessions SET state='ended',ended_at=? WHERE id=?")
      .run(now(), id);
    return this.db.prepare("SELECT * FROM study_sessions WHERE id=?").get(id);
  }
  audit() {
    if (
      (this.db.pragma("integrity_check") as any[])[0].integrity_check !== "ok"
    )
      throw new Error("数据库完整性失败");
    if ((this.db.pragma("foreign_key_check") as unknown[]).length)
      throw new Error("外键校验失败");
    this.totals();
    auditEconomy(this.db);
    const bad = this.db
      .prepare(
        "SELECT s.id FROM study_sessions s WHERE s.credited_ms != COALESCE((SELECT SUM(amount_ms) FROM time_entries WHERE session_id=s.id),0)",
      )
      .all();
    const slices = this.db
      .prepare(
        "SELECT id FROM time_entries e WHERE kind='study' AND amount_ms!=COALESCE((SELECT SUM(amount_ms) FROM study_day_slices WHERE entry_id=e.id),0)",
      )
      .all();
    const debits = this.db
      .prepare(
        "SELECT r.id FROM redemptions r LEFT JOIN time_entries e ON e.redemption_id=r.id WHERE r.currency='study_ms' AND (e.id IS NULL OR e.amount_ms != -r.price_amount)",
      )
      .all();
    const intents = this.db
      .prepare(
        "SELECT i.id FROM redemption_intents i LEFT JOIN redemptions r ON r.id=i.redemption_id WHERE i.state='confirmed' AND (r.id IS NULL OR r.intent_id!=i.id OR r.name_snapshot!=i.name_snapshot OR r.price_amount!=i.price_amount OR r.currency!=i.currency OR r.reward_id!=i.reward_id)",
      )
      .all();
    const watermarks = this.db
      .prepare(
        "SELECT id FROM (SELECT id,session_total_after_ms,SUM(amount_ms) OVER(PARTITION BY session_id ORDER BY seq) expected FROM time_entries WHERE kind='study') WHERE session_total_after_ms!=expected",
      )
      .all();
    const unsafe = this.db
      .prepare(
        `SELECT id FROM rewards WHERE typeof(price_points)!='integer' OR price_points<=0 OR price_points>${MAX_MS / 1000} UNION ALL SELECT id FROM study_sessions WHERE typeof(target_ms)!='integer' OR target_ms<=0 OR target_ms>${MAX_MS} OR typeof(credited_ms)!='integer' OR credited_ms<0 OR credited_ms>${MAX_MS} UNION ALL SELECT id FROM time_entries WHERE typeof(amount_ms)!='integer' OR abs(amount_ms)>${MAX_MS}`,
      )
      .all();
    if (
      bad.length ||
      slices.length ||
      debits.length ||
      intents.length ||
      watermarks.length ||
      unsafe.length
    )
      throw new Error("账本不变量校验失败");
  }
  close() {
    this.db.close();
  }
}
