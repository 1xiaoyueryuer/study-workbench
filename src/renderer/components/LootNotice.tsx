import { useEffect, useRef, useState } from "react";
import { catalog, rarities } from "../../shared/collection";
import type { Snapshot } from "../../shared/contracts";
import type { PageActions } from "../pages/Shop";
export function LootNotice({
  snapshot,
  call,
  lowMotion,
}: {
  snapshot: Snapshot;
  call: PageActions["call"];
  lowMotion: boolean;
}) {
  const [notice, setNotice] = useState<{
      count: number;
      latest: { sequence: number; catalog_id: string; rarity_snapshot: number };
    } | null>(null),
    [visible, setVisible] = useState(!document.hidden);
  const reading = useRef(false);
  useEffect(() => {
    const fn = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);
  useEffect(() => {
    if (!visible || !snapshot.datasetId || reading.current) return;
    reading.current = true;
    void call("getUnseenLoot")
      .then(async (r) => {
        if (r.count && r.latest) {
          setNotice({ count: r.count, latest: r.latest });
          await call("acknowledgeLoot", { sequence: r.latest.sequence });
        }
      })
      .catch(() => {})
      .finally(() => {
        reading.current = false;
      });
  }, [snapshot.datasetId, snapshot.latestLootEvent, visible]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const asset = catalog.find((c) => c.id === notice?.latest.catalog_id);
  return notice && asset ? (
    <div
      className={`loot-notice ${lowMotion ? "still" : ""}`}
      role="status"
      key={`${snapshot.datasetId}-${notice.latest.sequence}`}
    >
      <img src={`./${asset.thumbnail}`} alt="" />
      <span>
        {notice.count > 1
          ? `获得 ${notice.count} 件小宝贝，已放入仓库`
          : `获得 ${asset.name} · ${rarities[notice.latest.rarity_snapshot]}`}
      </span>
    </div>
  ) : null;
}
