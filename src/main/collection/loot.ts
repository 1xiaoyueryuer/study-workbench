import type Database from "better-sqlite3";
import { randomInt, randomUUID } from "node:crypto";
import { catalog, weights } from "../../shared/collection";
export type Rng = (min: number, max: number) => number;
export function draw(rng: Rng = randomInt) {
  const target = rng(600000, 1800001);
  let value = rng(0, 10000),
    rarity = 0;
  while (value >= weights[rarity]) value -= weights[rarity++];
  const choices = catalog.filter((c) => c.rarity === rarity);
  return { target, item: choices[rng(0, choices.length)] };
}
export function initializeLoot(db: Database.Database, rng: Rng = randomInt) {
  db.prepare(
    "INSERT INTO app_meta VALUES('loot_seen','0') ON CONFLICT(key) DO NOTHING",
  ).run();
  for (const c of catalog)
    db.prepare(
      "INSERT INTO collectible_catalog VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,model=excluded.model,thumbnail=excluded.thumbnail,asset_version=excluded.asset_version",
    ).run(
      c.id,
      c.name,
      c.rarity,
      c.sellPoints,
      c.model,
      c.thumbnail,
      c.assetVersion,
    );
  if (!db.prepare("SELECT id FROM loot_state").get()) {
    const next = draw(rng);
    db.prepare("INSERT INTO loot_state VALUES(1,1,?,0,?,1)").run(
      next.target,
      next.item.id,
    );
  }
}
export function freeSlot(db: Database.Database) {
  const occupied = new Set(
    (
      db
        .prepare(
          "SELECT slot_index FROM collectible_instances WHERE state='warehouse'",
        )
        .all() as { slot_index: number }[]
    ).map((r) => r.slot_index),
  );
  for (let i = 0; i < 50; i++) if (!occupied.has(i)) return i;
  return null;
}
export function advanceLoot(
  db: Database.Database,
  delta: number,
  rng: Rng = randomInt,
) {
  while (delta > 0) {
    const slot = freeSlot(db);
    if (slot === null) return;
    const s = db.prepare("SELECT * FROM loot_state").get() as {
      sequence: number;
      target_ms: number;
      progress_ms: number;
      catalog_id: string;
    };
    const step = Math.min(delta, s.target_ms - s.progress_ms);
    delta -= step;
    if (s.progress_ms + step < s.target_ms) {
      db.prepare(
        "UPDATE loot_state SET progress_ms=progress_ms+? WHERE id=1",
      ).run(step);
      return;
    }
    const c = db
      .prepare("SELECT * FROM collectible_catalog WHERE id=?")
      .get(s.catalog_id) as { rarity: number; sell_points: number };
    const id = randomUUID(),
      at = new Date().toISOString();
    db.prepare("INSERT INTO loot_events VALUES(?,?,?,1)").run(
      s.sequence,
      id,
      at,
    );
    db.prepare(
      "INSERT INTO collectible_instances VALUES(?,?,?,?,'warehouse',?,NULL,?,?)",
    ).run(id, s.catalog_id, c.rarity, c.sell_points, slot, s.sequence, at);
    const next = draw(rng);
    db.prepare(
      "UPDATE loot_state SET sequence=sequence+1,target_ms=?,progress_ms=0,catalog_id=? WHERE id=1",
    ).run(next.target, next.item.id);
  }
}
