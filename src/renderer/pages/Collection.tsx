import { useEffect, useState, type CSSProperties } from "react";
import {
  catalog,
  rarities,
  rarityColors,
  type Collectible,
} from "../../shared/collection";
import type { Appearance, Snapshot } from "../../shared/contracts";
import { Button, Modal } from "../components/ui";
import type { PageActions } from "./Shop";
import { CollectionScene } from "../scene/CollectionScene";
export function Collection({
  call,
  run,
  busy,
  snapshot,
  appearance,
}: PageActions & { snapshot: Snapshot; appearance: Appearance }) {
  const [warehouse, setWarehouse] = useState(false),
    [items, setItems] = useState<Collectible[]>([]),
    [display, setDisplay] = useState<Collectible[]>([]),
    [selected, setSelected] = useState<Collectible | null>(null),
    [sale, setSale] = useState<{ id: string; points: number } | null>(null),
    [placing, setPlacing] = useState(false),
    [error, setError] = useState("");
  const action = (fn: () => Promise<void>) =>
    run(async () => {
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  const refresh = async () => {
    setItems(await call("getInventory"));
    setDisplay(await call("getCollection"));
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [snapshot.datasetId, snapshot.dbRevision]);
  const asset = catalog.find((c) => c.id === selected?.catalog_id);
  return (
    <section className="collection-page">
      <header className="page-heading">
        <h1>{warehouse ? "仓库" : "收藏品"}</h1>
        {warehouse && (
          <Button variant="outline" onClick={() => setWarehouse(false)}>
            返回收藏品
          </Button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {warehouse ? (
        <>
          <div className="inventory-grid">
            {Array.from({ length: 50 }, (_, slot) => {
              const item = items.find((i) => i.slot_index === slot),
                c = catalog.find((c) => c.id === item?.catalog_id);
              return (
                <button
                  key={slot}
                  className={`inventory-slot ${item ? "occupied" : ""}`}
                  disabled={!item}
                  aria-label={
                    c
                      ? `${c.name}，${rarities[item!.rarity_snapshot]}`
                      : `空格 ${slot + 1}`
                  }
                  style={
                    {
                      "--rarity": rarityColors[item?.rarity_snapshot ?? 0],
                    } as CSSProperties
                  }
                  onClick={() => {
                    setSelected(item!);
                    setPlacing(false);
                  }}
                >
                  {c && <img src={`./${c.thumbnail}`} alt="" />}
                </button>
              );
            })}
          </div>
          <p className="inventory-foot">
            {items.length}/50{" "}
            {snapshot.lootBlockedByCapacity
              ? "· 仓库已满，腾出空格后继续获得宝贝"
              : ""}
          </p>
        </>
      ) : (
        <>
          <CollectionScene items={display} lowMotion={appearance.lowMotion} />
          <div className="tank-controls">
            {Array.from({ length: 6 }, (_, i) => {
              const item = display.find((v) => v.tank_index === i),
                c = catalog.find((v) => v.id === item?.catalog_id);
              return (
                <button
                  key={i}
                  onClick={() =>
                    item ? setSelected(item) : setWarehouse(true)
                  }
                  aria-label={`展示缸 ${i + 1}${c ? " " + c.name : " 空"}`}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {c?.name ?? "空缸"}
                </button>
              );
            })}
          </div>
          <Button
            className="warehouse-entry"
            onClick={() => setWarehouse(true)}
          >
            仓库 {items.length}/50
          </Button>
        </>
      )}
      <Modal
        open={!!selected}
        onClose={() => {
          setSelected(null);
          setSale(null);
          setPlacing(false);
        }}
        title={asset?.name ?? "收藏品"}
        description={asset?.meaning ?? ""}
      >
        {error && <p role="alert">{error}</p>}
        {asset && (
          <div className="collectible-detail">
            <img src={`./${asset.thumbnail}`} alt={asset.name} />
            <p style={{ color: rarityColors[selected!.rarity_snapshot] }}>
              {rarities[selected!.rarity_snapshot]} · 售价{" "}
              {selected?.sell_points_snapshot} 积分
            </p>
          </div>
        )}
        {selected?.state === "display" ? (
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await call("returnCollectible", { id: selected.id });
                setSelected(null);
                await refresh();
              })
            }
          >
            取回仓库
          </Button>
        ) : (
          <div className="button-row">
            <Button disabled={busy} onClick={() => setPlacing(!placing)}>
              放入展示
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setSale(await call("quoteSale", { ids: [selected!.id] })),
                )
              }
            >
              出售
            </Button>
          </div>
        )}
        {placing && (
          <div className="tank-picker">
            {Array.from({ length: 6 }, (_, tankIndex) => (
              <Button
                variant="outline"
                key={tankIndex}
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await call("placeCollectible", {
                      id: selected!.id,
                      tankIndex,
                    });
                    setSelected(null);
                    setPlacing(false);
                    await refresh();
                  })
                }
              >
                {tankIndex + 1} 号缸
                {display.some((i) => i.tank_index === tankIndex)
                  ? " · 交换"
                  : " · 空"}
              </Button>
            ))}
          </div>
        )}
        {sale && (
          <div className="sale-confirm">
            <p>出售后获得 {sale.points} 积分，物品不可恢复。</p>
            <Button
              disabled={busy}
              variant="danger"
              onClick={() =>
                void action(async () => {
                  await call("confirmSale", { intentId: sale.id });
                  setSale(null);
                  setSelected(null);
                  await refresh();
                })
              }
            >
              确认出售
            </Button>
          </div>
        )}
      </Modal>
    </section>
  );
}
