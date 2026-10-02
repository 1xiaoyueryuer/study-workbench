import { useEffect, useState } from "react";
import type { PageActions } from "./Shop";
import { Button } from "../components/ui";
import type { StorageUsage } from "../../shared/contracts";
const size = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
export function Storage({ call, run, busy }: PageActions) {
  const [usage, setUsage] = useState<StorageUsage | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void call("getStorageUsage")
      .then(setUsage)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel storage-panel">
      <h2>存储</h2>
      {error && <p role="alert">{error}</p>}
      {usage && (
        <>
          <div className="storage-grid">
            {(
              [
                ["用户资料", usage.attachments],
                ["数据库", usage.database],
                ["预览缓存", usage.cache],
                ["临时任务", usage.temporary],
                ["安全副本", usage.backups],
                ["旧数据集", usage.oldDatasets],
              ] as [string, number][]
            ).map(([name, n]) => (
              <div key={name}>
                <small>{name}</small>
                <strong>{size(n)}</strong>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const bytes =
                Number(new FormData(e.currentTarget).get("budget")) * 1024 ** 3;
              void run(async () => {
                await call("setStorageBudget", { bytes });
                setUsage(await call("getStorageUsage"));
              });
            }}
          >
            <label>
              资料预算（GiB）
              <input
                name="budget"
                type="number"
                min="1"
                max="1024"
                defaultValue={usage.budget / 1024 ** 3}
              />
            </label>
            <Button disabled={busy}>保存预算</Button>
          </form>
          <p className="muted">
            资料预算 {size(usage.budget)} · 可回收 {size(usage.reclaimable)}
          </p>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void run(async () => setUsage(await call("runCleanup")))
            }
          >
            清理可再生缓存与过期临时文件
          </Button>
        </>
      )}
    </section>
  );
}
