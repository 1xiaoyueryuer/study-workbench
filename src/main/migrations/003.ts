// Historical claimed_at marks prior ownership, not an actual pickup timestamp.
export const migration3 = `
CREATE TABLE collectible_instances_next(id TEXT PRIMARY KEY,catalog_id TEXT NOT NULL REFERENCES collectible_catalog(id),rarity_snapshot INTEGER NOT NULL CHECK(rarity_snapshot BETWEEN 0 AND 5),sell_points_snapshot INTEGER NOT NULL CHECK(sell_points_snapshot>0),state TEXT NOT NULL CHECK(state IN ('pending','warehouse','display','sold')),slot_index INTEGER UNIQUE,tank_index INTEGER UNIQUE,drop_event_id INTEGER UNIQUE NOT NULL REFERENCES loot_events(sequence),created_at TEXT NOT NULL,claimed_at TEXT,CHECK((state='pending' AND slot_index IS NULL AND tank_index IS NULL AND claimed_at IS NULL) OR (claimed_at IS NOT NULL AND ((state='warehouse' AND slot_index BETWEEN 0 AND 49 AND slot_index IS NOT NULL AND tank_index IS NULL) OR (state='display' AND tank_index BETWEEN 0 AND 5 AND tank_index IS NOT NULL AND slot_index IS NULL) OR (state='sold' AND slot_index IS NULL AND tank_index IS NULL)))));
INSERT INTO collectible_instances_next(id,catalog_id,rarity_snapshot,sell_points_snapshot,state,slot_index,tank_index,drop_event_id,created_at,claimed_at) SELECT id,catalog_id,rarity_snapshot,sell_points_snapshot,state,slot_index,tank_index,drop_event_id,created_at,created_at FROM collectible_instances;
DROP TABLE collectible_instances;
ALTER TABLE collectible_instances_next RENAME TO collectible_instances;
UPDATE loot_state SET rule_version=2;
`;
