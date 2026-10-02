import { Button } from "../components/ui";
import { duration, type Method } from "../../shared/contracts";
import type { FormEvent } from "react";
export type SessionRow = {
  id: string;
  credited_ms: number;
  target_ms: number;
  state: string;
  started_at: string;
  note: string;
};
export type DailySummary = {
  days: { local_date: string; ms: number }[];
  reviews: { local_date: string; note: string }[];
  clockEvents: { id: number; created_at: string; note: string }[];
};
export type FormSubmit = (
  action: (f: FormData) => Promise<void>,
) => (e: FormEvent<HTMLFormElement>) => void;
const field = (f: FormData, name: string) => String(f.get(name) ?? "");
const dateTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
const day = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
export function Records({
  rows,
  daily,
  offset,
  setOffset,
  busy,
  submit,
  mutate,
  setNotice,
}: {
  rows: SessionRow[];
  daily: DailySummary;
  offset: number;
  setOffset: (n: number) => void;
  busy: boolean;
  submit: FormSubmit;
  mutate: (m: Method, p?: unknown) => Promise<void>;
  setNotice: (s: string) => void;
}) {
  return (
    <>
      <h1 className="page-heading">学习记录</h1>
      <div className="two-columns">
        <section className="panel">
          <h2>学习记录</h2>
          {rows.length === 0 && (
            <Empty text="还没有学习记录。开始第一次专注吧。" />
          )}
          {rows.map((r) => (
            <article className="record" key={r.id}>
              <div>
                <strong>{duration(r.credited_ms)}</strong>
                <span className="tag">
                  {r.state === "ended" ? "已结束" : "进行中"}
                </span>
                <small>
                  {dateTime(r.started_at)} · 目标 {duration(r.target_ms)}
                </small>
              </div>
              <form
                onSubmit={submit(async (f) => {
                  await mutate("setSessionNote", {
                    id: r.id,
                    note: field(f, "note"),
                  });
                  setNotice("备注已保存");
                })}
              >
                <input
                  name="note"
                  defaultValue={r.note}
                  placeholder="这次学到了什么？"
                  maxLength={10000}
                />
                <Button variant="ghost" disabled={busy}>
                  保存
                </Button>
              </form>
            </article>
          ))}
          <Pager offset={offset} count={rows.length} onChange={setOffset} />
        </section>
        <section className="panel">
          <h2>每日复盘</h2>
          <form
            className="form"
            key={
              daily.reviews.find((r) => r.local_date === day())?.note ?? "new"
            }
            onSubmit={submit(async (f) => {
              await mutate("setDailyReview", {
                date: day(),
                note: field(f, "note"),
              });
              setNotice("今日复盘已保存");
            })}
          >
            <label>
              今天的收获与明天的计划
              <textarea
                name="note"
                rows={6}
                defaultValue={
                  daily.reviews.find((r) => r.local_date === day())?.note
                }
                placeholder="今天完成了什么？遇到了什么困难？"
              />
            </label>
            <Button disabled={busy}>保存今日复盘</Button>
          </form>
          <h3>最近 90 天</h3>
          {daily.days.map((d) => (
            <div className="daily" key={d.local_date}>
              <span>{d.local_date}</span>
              <strong>{duration(d.ms)}</strong>
            </div>
          ))}
          {daily.reviews
            .filter((r) => r.local_date !== day())
            .map((r) => (
              <article className="review" key={r.local_date}>
                <small>{r.local_date}</small>
                <p>{r.note}</p>
              </article>
            ))}
          {daily.clockEvents.map((r) => (
            <p className="muted" key={r.id}>
              {dateTime(r.created_at)} · {r.note}
            </p>
          ))}
        </section>
      </div>
    </>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span>◌</span>
      <p>{text}</p>
    </div>
  );
}
function Pager({
  offset,
  count,
  onChange,
}: {
  offset: number;
  count: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="pager">
      <button
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 50))}
      >
        上一页
      </button>
      <span>第 {offset / 50 + 1} 页</span>
      <button disabled={count < 50} onClick={() => onChange(offset + 50)}>
        下一页
      </button>
    </div>
  );
}
