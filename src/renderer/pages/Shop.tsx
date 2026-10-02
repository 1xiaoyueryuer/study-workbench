import { useEffect, useState } from "react";
import {
  duration,
  type Method,
  type MethodValue,
  type Snapshot,
} from "../../shared/contracts";
import { Button, Modal } from "../components/ui";
export type PageActions = {
  call: <K extends Method>(
    method: K,
    payload?: unknown,
  ) => Promise<MethodValue<K>>;
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
};
type Reward = { id: string; name: string; price_points: number };
type Receipt = {
  id: string;
  name_snapshot: string;
  price_amount: number;
  currency: string;
  created_at: string;
};
type Quote = {
  id: string;
  points?: number;
  timeMs?: number;
  name_snapshot?: string;
  price_amount?: number;
};
export function Shop({
  call,
  run,
  busy,
  snapshot,
}: PageActions & { snapshot: Snapshot }) {
  const [rewards, setRewards] = useState<Reward[]>([]),
    [history, setHistory] = useState<Receipt[]>([]),
    [editing, setEditing] = useState<Reward | null>(null),
    [quote, setQuote] = useState<Quote | null>(null),
    [kind, setKind] = useState<"conversion" | "purchase">("purchase"),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0);
  const refresh = async () => {
    setRewards(await call("listRewards"));
    setHistory(await call("listRedemptions", { offset }));
  };
  useEffect(() => {
    void refresh()
      .then(async () => {
        const i = await call("getRedemptionIntent");
        if (i) {
          setKind("purchase");
          setQuote(i);
        }
      })
      .catch((e) => setError(e.message));
  }, [snapshot.datasetId, offset]);
  const close = () =>
    void run(async () => {
      if (kind === "purchase" && quote)
        await call("cancelRedemption", { intentId: quote.id });
      setQuote(null);
    });
  return (
    <section className="shop">
      <header className="page-heading">
        <h1>奖励商店</h1>
        <strong>{snapshot.pointsBalance} 积分</strong>
      </header>
      {snapshot.migrationNotice && (
        <div className="migration-notice">
          旧奖励按每60秒1积分向上取整，历史收据与可用时长保留，价格可编辑。
          <button
            onClick={() =>
              void run(async () => {
                await call("dismissMigrationNotice");
              })
            }
          >
            知道了
          </button>
        </div>
      )}
      <form
        className="conversion-panel"
        onSubmit={(e) => {
          e.preventDefault();
          const points = Number(new FormData(e.currentTarget).get("points"));
          void run(async () => {
            setQuote(await call("quoteTimeConversion", { points }));
            setKind("conversion");
          });
        }}
      >
        <div>
          <h2>时间换积分</h2>
          <small>
            可用 {duration(snapshot.balanceMs + snapshot.pendingMs)} ·
            60秒兑换1积分
          </small>
        </div>
        <label>
          兑换积分
          <input
            name="points"
            type="number"
            min="1"
            max={Math.floor(snapshot.balanceMs / 60000)}
            defaultValue="1"
            required
          />
        </label>
        <Button disabled={busy || snapshot.balanceMs < 60000}>查看兑换</Button>
      </form>
      <div className="reward-layout">
        <div>
          <div className="reward-grid">
            {!rewards.length && <p>添加第一份奖励</p>}
            {rewards.map((r) => (
              <article className="reward-card" key={r.id}>
                <div className="reward-illustration">
                  <img src="./assets/Collection/chest.svg" alt="" />
                </div>
                <h2>{r.name}</h2>
                <p>{r.price_points} 积分</p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setQuote(
                        await call("prepareRedemption", { rewardId: r.id }),
                      );
                      setKind("purchase");
                    })
                  }
                >
                  兑换奖励
                </Button>
                <div className="reward-actions">
                  <button onClick={() => setEditing(r)}>编辑</button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await call("archiveReward", { id: r.id });
                        await refresh();
                      })
                    }
                  >
                    归档
                  </button>
                </div>
              </article>
            ))}
          </div>
          <section className="panel receipts">
            <h2>兑换记录</h2>
            {history.map((r) => (
              <div className="daily" key={r.id}>
                <div>
                  {r.name_snapshot}
                  <small>
                    {new Date(r.created_at).toLocaleString("zh-CN")}
                  </small>
                </div>
                <b>
                  −
                  {r.currency === "points"
                    ? `${r.price_amount} 积分`
                    : `${duration(r.price_amount)}（历史时长）`}
                </b>
              </div>
            ))}
            <div className="pager">
              <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
                上一页
              </button>
              <button
                disabled={history.length < 50}
                onClick={() => setOffset(offset + 50)}
              >
                下一页
              </button>
            </div>
          </section>
        </div>
        <section className="panel">
          <h2>{editing ? "编辑奖励" : "添加奖励"}</h2>
          <form
            key={editing?.id ?? "new"}
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await call("saveReward", {
                  ...(editing ? { id: editing.id } : {}),
                  name: String(f.get("name")),
                  pricePoints: Number(f.get("points")),
                });
                setEditing(null);
                await refresh();
              });
            }}
          >
            <label>
              奖励名称
              <input
                name="name"
                maxLength={160}
                required
                defaultValue={editing?.name}
              />
            </label>
            <label>
              积分价格
              <input
                name="points"
                type="number"
                min="1"
                max="8000000000"
                required
                defaultValue={editing?.price_points ?? 5}
              />
            </label>
            <Button disabled={busy}>{editing ? "保存修改" : "添加奖励"}</Button>
            {editing && (
              <button type="button" onClick={() => setEditing(null)}>
                取消编辑
              </button>
            )}
          </form>
        </section>
      </div>
      <Modal
        open={!!quote}
        onClose={close}
        title={kind === "conversion" ? "确认兑换积分" : "确认兑换奖励"}
        description={
          kind === "conversion"
            ? "只扣可用时长，累计学习保持不变。"
            : "确认后扣除积分。"
        }
      >
        <div className="receipt-preview">
          {kind === "conversion" ? (
            <p>
              消耗 {duration(quote?.timeMs ?? 0)} → {quote?.points} 积分
              <br />
              兑换后可用 {duration(snapshot.balanceMs - (quote?.timeMs ?? 0))}
            </p>
          ) : (
            <p>
              {quote?.name_snapshot} · {quote?.price_amount} 积分
            </p>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              try {
                await call(
                  kind === "conversion"
                    ? "confirmTimeConversion"
                    : "confirmRedemption",
                  { intentId: quote!.id },
                );
                setQuote(null);
                setError("");
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })
          }
        >
          确认兑换
        </Button>
      </Modal>
    </section>
  );
}
