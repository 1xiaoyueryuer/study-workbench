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
type Reward = { id: string; name: string; price_ms: number };
type Receipt = {
  id: string;
  name_snapshot: string;
  price_amount: number;
  charged_ms: number;
  created_at: string;
};
type Quote = {
  id: string;
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
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0),
    [tab, setTab] = useState("rewards");
  const refresh = async () => {
    setRewards(await call("listRewards"));
    setHistory(await call("listRedemptions", { offset }));
  };
  useEffect(() => {
    void refresh()
      .then(async () => {
        const i = await call("getRedemptionIntent");
        if (i) {
          setQuote(i);
        }
      })
      .catch((e) => setError(e.message));
  }, [snapshot.datasetId, offset]);
  const close = () =>
    void run(async () => {
      if (quote) await call("cancelRedemption", { intentId: quote.id });
      setQuote(null);
    });
  return (
    <section className="shop">
      <header className="page-heading">
        <h1>奖励商店</h1>
        <strong>
          可用 {duration(snapshot.balanceMs + snapshot.pendingMs)}
        </strong>
      </header>
      <div className="settings-tabs" role="tablist" aria-label="商店分类">
        {[
          ["rewards", "奖励"],
          ["history", "兑换记录"],
        ].map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "rewards" && (
        <div className="reward-layout">
          <div>
            <div className="reward-grid">
              {!rewards.length && <p>添加第一份奖励</p>}
              {rewards.map((r) => (
                <article className="reward-card" key={r.id}>
                  <div className="reward-illustration">
                    <img src="./assets/Lucide/gift.svg" alt="" />
                  </div>
                  <h2>{r.name}</h2>
                  <p>{duration(r.price_ms)}</p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setQuote(
                          await call("prepareRedemption", { rewardId: r.id }),
                        );
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
                    priceMs: Math.round(Number(f.get("minutes")) * 60000),
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
                所需时间（分钟）
                <input
                  name="minutes"
                  type="number"
                  min="0.001"
                  step="0.001"
                  max="133333333"
                  required
                  defaultValue={(editing?.price_ms ?? 300000) / 60000}
                />
              </label>
              <Button disabled={busy}>
                {editing ? "保存修改" : "添加奖励"}
              </Button>
              {editing && (
                <button type="button" onClick={() => setEditing(null)}>
                  取消编辑
                </button>
              )}
            </form>
          </section>
        </div>
      )}
      {tab === "history" && (
        <section className="panel receipts">
          <h2>兑换记录</h2>
          {history.map((r) => (
            <div className="daily" key={r.id}>
              <div>
                {r.name_snapshot}
                <small>{new Date(r.created_at).toLocaleString("zh-CN")}</small>
              </div>
              <b>−{duration(r.charged_ms)}</b>
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
      )}
      <Modal
        open={!!quote}
        onClose={close}
        title="确认兑换奖励"
        description="只扣可用学习时间，累计学习记录保持不变。"
      >
        <div className="receipt-preview">
          <p>
            {quote?.name_snapshot} · {duration(quote?.price_amount ?? 0)}
          </p>
          <p>
            兑换后可用{" "}
            {duration(
              Math.max(
                0,
                snapshot.balanceMs +
                  snapshot.pendingMs -
                  (quote?.price_amount ?? 0),
              ),
            )}
          </p>
        </div>
        {error && <p role="alert">{error}</p>}
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              try {
                await call("confirmRedemption", { intentId: quote!.id });
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
