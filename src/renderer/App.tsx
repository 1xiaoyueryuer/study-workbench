import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  defaults,
  duration,
  type Bridge,
  type Method,
  type Snapshot,
  type Settings,
} from "../shared/contracts";
import { Tank } from "./Tank";
import { FileTask } from "./components/FileTask";
import { LootNotice } from "./components/LootNotice";
import { Shop } from "./pages/Shop";
import { Collection } from "./pages/Collection";
import { Records, type SessionRow, type DailySummary } from "./pages/Records";
import { Settings as SettingsPage, type BackupPreview } from "./pages/Settings";
import { Home } from "./Home";
import { ResourceLibrary } from "./ResourceLibrary";
import { Button, Modal } from "./components/ui";
declare global {
  interface Window {
    workbench: Bridge;
  }
}
const pages = [
  ["home", "学习首页", "clock"],
  ["records", "学习记录", "calendar"],
  ["resources", "学习资料", "book"],
  ["collection", "收藏品", "gift"],
  ["rewards", "奖励商店", "gift"],
  ["settings", "设置", "target"],
] as const;
const initial: Snapshot = {
  protocolVersion: 1,
  datasetId: "",
  processEpoch: "",
  snapshotSeq: 0,
  dbRevision: 0,
  emittedAtUtc: "",
  phase: "idle",
  pauseReasons: [],
  storage: "ok",
  session: null,
  pointsBalance: 0,
  inventoryCount: 0,
  displayCount: 0,
  lootBlockedByCapacity: false,
  latestLootEvent: 0,
  migrationNotice: false,
  earnedMs: 0,
  balanceMs: 0,
  pendingMs: 0,
  todayMs: 0,
  lastCheckpointAt: null,
};
export function App() {
  const [snapshot, setSnapshot] = useState(initial),
    [settings, setSettings] = useState<Settings>(defaults),
    [page, setPage] = useState("home"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<SessionRow[]>([]),
    [daily, setDaily] = useState<DailySummary>({
      days: [],
      reviews: [],
      clockEvents: [],
    }),
    [backup, setBackup] = useState<BackupPreview | null>(null),
    [offset, setOffset] = useState(0),
    [target, setTarget] = useState(60),
    [synced, setSynced] = useState(true);
  const current = useRef(snapshot);
  const gate = useRef(false);
  const received = useRef(Date.now());
  const requestCache = useRef(new Map<string, string>());
  const apply = useCallback((s: Snapshot) => {
    const prev = current.current;
    if (
      prev.processEpoch === s.processEpoch &&
      prev.datasetId === s.datasetId &&
      s.snapshotSeq <= prev.snapshotSeq
    )
      return;
    current.current = s;
    received.current = Date.now();
    setSnapshot(s);
  }, []);
  const call = useCallback(async (method: Method, payload: unknown = {}) => {
    const key = method + JSON.stringify(payload);
    const operationId = requestCache.current.get(key) ?? crypto.randomUUID();
    requestCache.current.set(key, operationId);
    const result = await window.workbench[method]({
      datasetId: current.current.datasetId,
      operationId,
      payload,
    });
    if (!result.ok) {
      if (!result.error.retryable) requestCache.current.delete(key);
      throw new Error(result.error.message);
    }
    requestCache.current.delete(key);
    return result.value;
  }, []);
  const refresh = useCallback(
    async (p = page, o = offset) => {
      if (!current.current.datasetId) return;
      const s = await call("getSettings");
      setSettings(s);
      if (p === "home" || p === "records") {
        setDaily(await call("getDailySummary"));
        if (p === "records") setRows(await call("listSessions", { offset: o }));
      }
    },
    [call, page, offset],
  );
  useEffect(() => {
    if (!window.workbench) {
      setError("请通过桌面应用启动，浏览器预览不提供真实计时服务。");
      return;
    }
    const off = window.workbench.subscribeSnapshot(apply);
    void window.workbench.getSnapshot({
      datasetId: "",
      operationId: crypto.randomUUID(),
      payload: {},
    });
    const poll = setInterval(
      () => setSynced(Date.now() - received.current < 1500),
      500,
    );
    return () => {
      off();
      clearInterval(poll);
    };
  }, [apply]);
  useEffect(() => {
    if (snapshot.datasetId) void refresh().catch((e) => setError(e.message));
  }, [snapshot.datasetId, page, offset]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.appearance.theme;
    document.documentElement.dataset.font = settings.appearance.font;
    document.documentElement.style.fontSize =
      settings.appearance.fontSize + "px";
    document.documentElement.dataset.motion = settings.appearance.lowMotion
      ? "low"
      : "normal";
  }, [settings.appearance]);
  const run = async (action: () => Promise<void>) => {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      gate.current = false;
      setBusy(false);
    }
  };
  const mutate = async (m: Method, p: unknown = {}) => {
    await call(m, p);
    await refresh();
  };
  const submit =
    (fn: (data: FormData) => Promise<void>) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = new FormData(form);
      void run(async () => {
        await fn(data);
        form.reset();
      });
    };
  const icon = (name: string) => (
    <img src={`./assets/${settings.appearance.icons}/${name}.svg`} alt="" />
  );
  const active = !!snapshot.session;
  const running = snapshot.phase === "running";

  useEffect(
    () => setTarget(settings.goal.targetMs / 60000),
    [settings.goal.targetMs],
  );
  const controls = (
    <div className="controls">
      {!active ? (
        <Button
          disabled={busy || !snapshot.datasetId || !synced}
          onClick={() =>
            void run(() =>
              mutate("startStudy", { targetMs: Math.round(target * 60000) }),
            )
          }
        >
          {icon("clock")}开始学习 <span>↗</span>
        </Button>
      ) : (
        <>
          <Button
            disabled={busy || snapshot.storage === "error" || !synced}
            onClick={() =>
              void run(() =>
                mutate(
                  snapshot.phase === "recovery_pending"
                    ? "resolveRecovery"
                    : running
                      ? "pauseStudy"
                      : "resumeStudy",
                  snapshot.phase === "recovery_pending"
                    ? { action: "resume" }
                    : {},
                ),
              )
            }
          >
            {running ? "Ⅱ 暂停学习" : "▷ 继续学习"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || snapshot.storage === "error"}
            onClick={() =>
              void run(() =>
                mutate("endStudy", { sessionId: snapshot.session!.id }),
              )
            }
          >
            结束并保存
          </Button>
        </>
      )}
    </div>
  );
  return (
    <div
      className={`shell ${page === "home" ? "home-shell" : ""} ${active ? "immersed" : ""}`}
    >
      <Tank snapshot={snapshot} appearance={settings.appearance} />
      <LootNotice
        snapshot={snapshot}
        call={call}
        lowMotion={settings.appearance.lowMotion}
      />
      <FileTask call={call} />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">汀</div>
          <div>
            <strong>积水书房</strong>
          </div>
        </div>
        <div className="nav-label">我的学习空间</div>
        <nav>
          {pages.map(([key, title, img]) => (
            <button
              key={key}
              className={page === key ? "selected" : ""}
              onClick={() => {
                setPage(key);
                setOffset(0);
              }}
            >
              {icon(img)}
              {title}
              {page === key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <img
            className="botanical"
            src="./assets/Botanical/lavender.svg"
            alt=""
          />

          <div className="offline">
            <i />
            离线书房 · 数据留在本机
          </div>
          <small>0.4.0</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            我的书房 <span>/</span> {pages.find((p) => p[0] === page)?.[1]}
          </div>
          <div className="top-right">
            <span className="status-dot" />
            {running
              ? "正在积累专注"
              : active
                ? "学习已暂停"
                : "准备好，慢慢来"}
            <span className="date-chip">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
          </div>
        </header>
        {page !== "home" && active && (
          <div className="mini-session">
            <span>
              本次学习 <b>{duration(snapshot.session!.effectiveMs)}</b>
            </span>
            {controls}
          </div>
        )}
        {!synced && (
          <div className="alert">正在重新同步主进程，显示时间已停止外推。</div>
        )}
        {error && (
          <div role="alert" className="alert error">
            {error}
            <button aria-label="关闭错误提示" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="alert success">
            {notice}
          </div>
        )}
        {snapshot.storage === "error" && (
          <div className="alert error">
            {snapshot.pauseReasons.join("；")}
            <Button onClick={() => void run(() => mutate("retrySave"))}>
              重试保存
            </Button>
          </div>
        )}
        <div
          className={`page-content ${page === "home" ? "home-content" : ""}`}
        >
          {page === "home" && (
            <Home
              snapshot={snapshot}
              settings={settings}
              target={target}
              setTarget={setTarget}
              controls={controls}
              onSettings={() => setPage("settings")}
            />
          )}
          {page === "records" && (
            <Records
              rows={rows}
              daily={daily}
              offset={offset}
              setOffset={setOffset}
              busy={busy}
              submit={submit}
              mutate={mutate}
              setNotice={setNotice}
            />
          )}
          {page === "rewards" && (
            <Shop call={call} run={run} busy={busy} snapshot={snapshot} />
          )}
          {page === "resources" && (
            <ResourceLibrary
              call={call}
              run={run}
              busy={busy}
              datasetId={snapshot.datasetId}
            />
          )}
          {page === "collection" && (
            <Collection
              call={call}
              run={run}
              busy={busy}
              snapshot={snapshot}
              appearance={settings.appearance}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              settings={settings}
              call={call}
              run={run}
              busy={busy}
              submit={submit}
              mutate={mutate}
              setNotice={setNotice}
              setTarget={setTarget}
              setBackup={setBackup}
            />
          )}
        </div>
      </main>
      <Modal
        open={!!backup}
        onClose={() => setBackup(null)}
        title="替换全部书房数据？"
        description="恢复不会合并数据。当前完整数据会先自动备份并保留，旧页面请求将失效。"
      >
        <p>备份时间：{backup?.createdAt}</p>
        <p>
          {backup?.sessionCount} 条学习记录 · {backup?.resourceCount} 份资料
        </p>
        <p>累计学习 {duration(backup?.earnedMs ?? 0)}</p>
        {error && <p role="alert">{error}</p>}
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await call("restoreBackup", {
                token: backup!.token,
                confirmed: true,
              });
              setBackup(null);
              setNotice("恢复完成，原数据备份已保留");
              await refresh();
            })
          }
        >
          确认替换全部数据
        </Button>
      </Modal>
    </div>
  );
}
