// Keep migration 1-3 checksums immutable. Upgrade both published schema 2 and draft schema 3.
// Remove collection/points; return converted time and retain every completed reward debit.
export const migration4 = `
ALTER TABLE rewards RENAME COLUMN price_points TO price_ms;
UPDATE rewards SET price_ms=price_ms*60000;
UPDATE redemption_intents SET price_amount=price_amount*60000,currency='study_ms',state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END WHERE currency='points';
UPDATE redemptions SET price_amount=price_amount*60000,currency='study_ms' WHERE currency='points';
CREATE TABLE learning_entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,amount_ms INTEGER NOT NULL,session_id TEXT REFERENCES study_sessions(id),redemption_id TEXT UNIQUE REFERENCES redemptions(id),session_total_after_ms INTEGER,created_at TEXT NOT NULL,CHECK((kind='study' AND amount_ms>0 AND session_id IS NOT NULL AND redemption_id IS NULL) OR (kind='redeem' AND amount_ms<=0 AND session_id IS NULL AND redemption_id IS NOT NULL)));
INSERT INTO learning_entries SELECT seq,id,kind,amount_ms,session_id,redemption_id,session_total_after_ms,created_at FROM time_entries WHERE kind IN ('study','redeem');
INSERT INTO learning_entries(id,kind,amount_ms,redemption_id,created_at) SELECT 'legacy-reward-'||r.id,'redeem',-r.price_amount,r.id,r.created_at FROM redemptions r WHERE NOT EXISTS(SELECT 1 FROM learning_entries e WHERE e.redemption_id=r.id);
-- Legacy purchases funded by collectible sales keep their receipt but debit only
-- converted learning time. A zero-time legacy receipt remains valid historical data.
WITH allocation AS MATERIALIZED (
 SELECT id,MIN(-amount_ms,MAX(0,COALESCE((SELECT SUM(time_ms) FROM time_conversions),0)-COALESCE(SUM(-amount_ms) OVER(ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0))) debit
 FROM learning_entries WHERE id LIKE 'legacy-reward-%'
)
UPDATE learning_entries SET amount_ms=-(SELECT debit FROM allocation WHERE allocation.id=learning_entries.id) WHERE id IN (SELECT id FROM allocation);
ALTER TABLE redemptions ADD COLUMN charged_ms INTEGER NOT NULL DEFAULT 0 CHECK(charged_ms>=0);
UPDATE redemptions SET charged_ms=-(SELECT amount_ms FROM learning_entries WHERE redemption_id=redemptions.id);
CREATE TABLE learning_slices(entry_id TEXT NOT NULL REFERENCES learning_entries(id),local_date TEXT NOT NULL,timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',amount_ms INTEGER NOT NULL CHECK(amount_ms>0),PRIMARY KEY(entry_id,local_date,timezone));
INSERT INTO learning_slices SELECT * FROM study_day_slices;
DROP TABLE study_day_slices;
DROP TABLE time_entries;
ALTER TABLE learning_entries RENAME TO time_entries;
ALTER TABLE learning_slices RENAME TO study_day_slices;
CREATE UNIQUE INDEX income_per_session ON time_entries(session_id) WHERE kind='study';
CREATE INDEX daily_date ON study_day_slices(local_date);
DROP TABLE point_entries;
DROP TABLE sales;
DROP TABLE business_intents;
DROP TABLE collectible_instances;
DROP TABLE loot_events;
DROP TABLE loot_state;
DROP TABLE collectible_catalog;
DROP TABLE time_conversions;
DELETE FROM app_meta WHERE key IN ('loot_seen','economy_migration_notice');
DELETE FROM command_results WHERE kind IN ('quoteTimeConversion','confirmTimeConversion','listPointTransactions','collectLoot','getPendingLoot','getCollection','getUnseenLoot','acknowledgeLoot','getInventory','placeCollectible','returnCollectible','quoteSale','confirmSale','dismissMigrationNotice','saveReward','prepareRedemption','confirmRedemption');
`;
