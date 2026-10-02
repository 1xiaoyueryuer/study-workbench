import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DomainError, MAX_MS, type Snapshot } from "../../shared/contracts";
import type { Collectible } from "../../shared/collection";
import { freeSlot } from "../collection/loot";
type DB = Database.Database;
const now = () => new Date().toISOString();
function fail(message: string, code = "INVALID_INPUT"): never {
  throw new DomainError(code, message);
}
function safe(n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_MS) fail("金额超过安全范围");
  return n;
}
export function points(db: DB) {
  return safe(
    (
      db
        .prepare("SELECT COALESCE(SUM(amount),0) n FROM point_entries")
        .get() as { n: number }
    ).n,
  );
}
function inventory(db: DB, state: string) {
  return db
    .prepare(
      "SELECT * FROM collectible_instances WHERE state=? ORDER BY slot_index,tank_index",
    )
    .all(state) as Collectible[];
}
export type EconomySnapshot = Pick<
  Snapshot,
  | "pointsBalance"
  | "inventoryCount"
  | "displayCount"
  | "lootBlockedByCapacity"
  | "latestLootEvent"
  | "migrationNotice"
>;
export function economyRead(
  db: DB,
  method: "snapshot",
  p: { offset?: number },
): EconomySnapshot;
export function economyRead(
  db: DB,
  method: string,
  p: { offset?: number },
): unknown;
export function economyRead(
  db: DB,
  method: string,
  p: { offset?: number },
): unknown {
  switch (method) {
    case "snapshot": {
      const n = inventory(db, "warehouse").length;
      return {
        pointsBalance: points(db),
        inventoryCount: n,
        displayCount: inventory(db, "display").length,
        lootBlockedByCapacity: n === 50,
        latestLootEvent: (
          db
            .prepare("SELECT COALESCE(MAX(sequence),0) n FROM loot_events")
            .get() as { n: number }
        ).n,
        migrationNotice:
          (
            db
              .prepare(
                "SELECT value FROM app_meta WHERE key='economy_migration_notice'",
              )
              .get() as { value: string }
          ).value === "1",
      };
    }
    case "getInventory":
      return inventory(db, "warehouse");
    case "getCollection":
      return inventory(db, "display");
    case "listPointTransactions":
      return db
        .prepare(
          "SELECT * FROM point_entries ORDER BY rowid DESC LIMIT 50 OFFSET ?",
        )
        .all(p.offset ?? 0);
    default:
      return undefined;
  }
}
type Payload = {
  id?: string;
  name?: string;
  pricePoints?: number;
  rewardId?: string;
  intentId?: string;
  points?: number;
  ids?: string[];
  tankIndex?: number;
};
type Intent = {
  id: string;
  kind: string;
  payload_json: string;
  amount: number;
  state: string;
  result_json: string | null;
};
function getIntent(db: DB, id: string, kind: string) {
  const i = db
    .prepare("SELECT * FROM business_intents WHERE id=? AND kind=?")
    .get(id, kind) as Intent | undefined;
  if (!i) fail("确认单不存在");
  return i;
}
export function economyMutate(
  db: DB,
  method: string,
  p: Payload,
  balance: () => number,
): unknown {
  const ledger = (
    amount: number,
    kind: string,
    conversion: string | null,
    sale: string | null,
    purchase: string | null,
  ) => {
    safe(points(db) + amount);
    db.prepare("INSERT INTO point_entries VALUES(?,?,?,?,?,?,?)").run(
      randomUUID(),
      amount,
      kind,
      conversion,
      sale,
      purchase,
      now(),
    );
  };
  switch (method) {
    case "quoteTimeConversion": {
      const amount = safe(p.points!),
        time = safe(amount * 60000);
      if (balance() < time) fail("可用时长不足", "INSUFFICIENT_BALANCE");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO business_intents VALUES(?,'conversion',?,?,'pending',NULL)",
      ).run(id, JSON.stringify({ timeMs: time }), amount);
      return { id, points: amount, timeMs: time };
    }
    case "confirmTimeConversion": {
      const i = getIntent(db, p.intentId!, "conversion");
      if (i.state === "confirmed") return JSON.parse(i.result_json!);
      const time = safe(i.amount * 60000);
      if (balance() < time) fail("可用时长不足", "INSUFFICIENT_BALANCE");
      const id = randomUUID(),
        result = { id, points: i.amount, timeMs: time };
      db.prepare("INSERT INTO time_conversions VALUES(?,?,?,?,1,?)").run(
        id,
        i.id,
        time,
        i.amount,
        now(),
      );
      db.prepare(
        "INSERT INTO time_entries(id,kind,amount_ms,conversion_id,created_at) VALUES(?,'conversion',?,?,?)",
      ).run(randomUUID(), -time, id, now());
      ledger(i.amount, "conversion", id, null, null);
      db.prepare(
        "UPDATE business_intents SET state='confirmed',result_json=? WHERE id=?",
      ).run(JSON.stringify(result), i.id);
      return result;
    }
    case "quoteSale": {
      const items = p.ids!.map(
        (id) =>
          db
            .prepare(
              "SELECT * FROM collectible_instances WHERE id=? AND state='warehouse'",
            )
            .get(id) as Collectible | undefined,
      );
      if (items.some((i) => !i)) fail("只能出售仓库中持有的物品");
      const amount = safe(
          items.reduce((s, i) => s + i!.sell_points_snapshot, 0),
        ),
        id = randomUUID();
      db.prepare(
        "INSERT INTO business_intents VALUES(?,'sale',?,?,'pending',NULL)",
      ).run(id, JSON.stringify(p.ids), amount);
      return { id, points: amount, count: items.length };
    }
    case "confirmSale": {
      const i = getIntent(db, p.intentId!, "sale");
      if (i.state === "confirmed") return JSON.parse(i.result_json!);
      const ids = JSON.parse(i.payload_json) as string[];
      const items = ids.map(
        (id) =>
          db
            .prepare(
              "SELECT * FROM collectible_instances WHERE id=? AND state='warehouse'",
            )
            .get(id) as Collectible | undefined,
      );
      if (
        items.some((v) => !v) ||
        items.reduce((s, v) => s + v!.sell_points_snapshot, 0) !== i.amount
      )
        fail("物品位置已变化，请重新选择");
      const id = randomUUID(),
        result = { id, points: i.amount };
      for (const item of ids)
        db.prepare(
          "UPDATE collectible_instances SET state='sold',slot_index=NULL WHERE id=?",
        ).run(item);
      db.prepare("INSERT INTO sales VALUES(?,?,?,?,?)").run(
        id,
        i.id,
        i.payload_json,
        i.amount,
        now(),
      );
      ledger(i.amount, "sale", null, id, null);
      db.prepare(
        "UPDATE business_intents SET state='confirmed',result_json=? WHERE id=?",
      ).run(JSON.stringify(result), i.id);
      return result;
    }
    case "placeCollectible": {
      const item = db
        .prepare(
          "SELECT * FROM collectible_instances WHERE id=? AND state='warehouse'",
        )
        .get(p.id) as Collectible | undefined;
      if (!item) fail("物品已不在仓库");
      const previous = db
        .prepare("SELECT id FROM collectible_instances WHERE tank_index=?")
        .get(p.tankIndex) as { id: string } | undefined;
      // Temporary sold state is confined to this transaction; frees both unique positions.
      db.prepare(
        "UPDATE collectible_instances SET state='sold',slot_index=NULL WHERE id=?",
      ).run(item.id);
      if (previous)
        db.prepare(
          "UPDATE collectible_instances SET state='warehouse',tank_index=NULL,slot_index=? WHERE id=?",
        ).run(item.slot_index, previous.id);
      db.prepare(
        "UPDATE collectible_instances SET state='display',tank_index=? WHERE id=?",
      ).run(p.tankIndex, item.id);
      return null;
    }
    case "returnCollectible": {
      const slot = freeSlot(db);
      if (slot === null) fail("仓库已满，请先腾出一格");
      if (
        !db
          .prepare(
            "UPDATE collectible_instances SET state='warehouse',tank_index=NULL,slot_index=? WHERE id=? AND state='display'",
          )
          .run(slot, p.id).changes
      )
        fail("物品已不在展示缸");
      return null;
    }
    case "saveReward": {
      const id = p.id ?? randomUUID();
      if (p.id) {
        if (
          !db
            .prepare(
              "UPDATE rewards SET name=?,price_points=?,version=version+1 WHERE id=? AND archived_at IS NULL",
            )
            .run(p.name, p.pricePoints, id).changes
        )
          fail("奖励不存在");
      } else
        db.prepare("INSERT INTO rewards VALUES(?,?,?,1,NULL)").run(
          id,
          p.name,
          p.pricePoints,
        );
      return { id };
    }
    case "archiveReward":
      db.prepare(
        "UPDATE rewards SET archived_at=?,version=version+1 WHERE id=?",
      ).run(now(), p.id);
      return null;
    case "prepareRedemption": {
      const existing = db
        .prepare("SELECT * FROM redemption_intents WHERE state='pending'")
        .get();
      if (existing) return existing;
      const r = db
        .prepare("SELECT * FROM rewards WHERE id=? AND archived_at IS NULL")
        .get(p.rewardId) as
        | { id: string; version: number; name: string; price_points: number }
        | undefined;
      if (!r) fail("奖励已归档", "REWARD_CHANGED");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO redemption_intents VALUES(?,?,?,?,?,'pending',NULL,'points')",
      ).run(id, r.id, r.version, r.name, r.price_points);
      return db.prepare("SELECT * FROM redemption_intents WHERE id=?").get(id);
    }
    case "cancelRedemption":
      db.prepare(
        "UPDATE redemption_intents SET state='cancelled' WHERE id=? AND state='pending'",
      ).run(p.intentId);
      return null;
    case "confirmRedemption": {
      const i = db
        .prepare("SELECT * FROM redemption_intents WHERE id=?")
        .get(p.intentId) as
        | {
            id: string;
            reward_id: string;
            reward_version: number;
            name_snapshot: string;
            price_amount: number;
            currency: string;
            state: string;
            redemption_id: string;
          }
        | undefined;
      if (!i) fail("兑换意图不存在");
      if (i.state === "confirmed")
        return db
          .prepare("SELECT * FROM redemptions WHERE id=?")
          .get(i.redemption_id);
      if (i.state !== "pending" || i.currency !== "points")
        fail("报价已取消，请重新选择");
      const r = db
        .prepare("SELECT * FROM rewards WHERE id=?")
        .get(i.reward_id) as { version: number; archived_at: string | null };
      if (r.archived_at || r.version !== i.reward_version)
        fail("奖励已变化，请取消后重新选择", "REWARD_CHANGED");
      if (points(db) < i.price_amount) fail("积分不足", "INSUFFICIENT_BALANCE");
      const id = randomUUID();
      db.prepare("INSERT INTO redemptions VALUES(?,?,?,?,?,?,'points')").run(
        id,
        i.id,
        i.reward_id,
        i.name_snapshot,
        i.price_amount,
        now(),
      );
      ledger(-i.price_amount, "purchase", null, null, id);
      db.prepare(
        "UPDATE redemption_intents SET state='confirmed',redemption_id=? WHERE id=?",
      ).run(id, i.id);
      return db.prepare("SELECT * FROM redemptions WHERE id=?").get(id);
    }
    default:
      return undefined;
  }
}
export function auditEconomy(db: DB) {
  points(db);
  const bad = db
    .prepare(
      `SELECT c.id FROM time_conversions c LEFT JOIN time_entries t ON t.conversion_id=c.id LEFT JOIN point_entries p ON p.conversion_id=c.id WHERE t.id IS NULL OR p.id IS NULL OR t.amount_ms!=-c.time_ms OR p.amount!=c.points
    UNION ALL SELECT r.id FROM redemptions r LEFT JOIN point_entries p ON p.redemption_id=r.id WHERE r.currency='points' AND (p.id IS NULL OR p.amount!=-r.price_amount)
    UNION ALL SELECT s.id FROM sales s LEFT JOIN point_entries p ON p.sale_id=s.id WHERE p.id IS NULL OR p.amount!=s.points
    UNION ALL SELECT i.id FROM collectible_instances i LEFT JOIN loot_events e ON e.sequence=i.drop_event_id WHERE e.instance_id IS NULL OR e.instance_id!=i.id`,
    )
    .all();
  const sold = new Set<string>();
  for (const sale of db.prepare("SELECT * FROM sales").all() as {
    id: string;
    items_json: string;
    points: number;
  }[]) {
    const ids = JSON.parse(sale.items_json) as unknown;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 50 ||
      new Set(ids).size !== ids.length
    )
      throw new Error("出售收据无效");
    let total = 0;
    for (const id of ids) {
      if (typeof id !== "string" || sold.has(id))
        throw new Error("物品重复出售");
      sold.add(id);
      const item = db
        .prepare(
          "SELECT state,sell_points_snapshot FROM collectible_instances WHERE id=?",
        )
        .get(id) as { state: string; sell_points_snapshot: number } | undefined;
      if (!item || item.state !== "sold")
        throw new Error("出售收据与物品状态不一致");
      total += item.sell_points_snapshot;
    }
    if (!Number.isSafeInteger(total) || total !== sale.points)
      throw new Error("出售金额不一致");
  }
  const soldCount = (
    db
      .prepare(
        "SELECT COUNT(*) n FROM collectible_instances WHERE state='sold'",
      )
      .get() as { n: number }
  ).n;
  if (soldCount !== sold.size) throw new Error("售出物品缺少收据");
  const unsafe = db
    .prepare(
      "SELECT id FROM collectible_instances WHERE typeof(rarity_snapshot)!='integer' OR typeof(sell_points_snapshot)!='integer' OR sell_points_snapshot>8000000000000 OR (slot_index IS NOT NULL AND typeof(slot_index)!='integer') OR (tank_index IS NOT NULL AND typeof(tank_index)!='integer') UNION ALL SELECT CAST(id AS TEXT) FROM loot_state WHERE typeof(sequence)!='integer' OR typeof(target_ms)!='integer' OR typeof(progress_ms)!='integer'",
    )
    .all();
  if (unsafe.length) throw new Error("收藏数值无效");
  if (bad.length) throw new Error("积分或收藏不变量校验失败");
}
