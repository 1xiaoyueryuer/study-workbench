import type { ReactNode } from "react";
import {
  countdown,
  duration,
  type Snapshot,
  type Settings,
} from "../shared/contracts";
export function Home({
  snapshot,
  settings,
  target,
  setTarget,
  controls,
  onSettings,
}: {
  snapshot: Snapshot;
  settings: Settings;
  target: number;
  setTarget: (n: number) => void;
  controls: ReactNode;
  onSettings: () => void;
}) {
  const active = !!snapshot.session,
    running = snapshot.phase === "running",
    progress = active
      ? snapshot.session!.effectiveMs / snapshot.session!.targetMs
      : 0,
    pending = snapshot.pendingMs;
  return (
    <section
      className={`rain-home ${active ? "is-active" : ""} ${running ? "is-raining" : ""}`}
      data-testid="rain-home"
    >
      <div className="rain-home-content">
        <header className="rain-heading">
          <div>
            <h1>学习首页</h1>
          </div>
          <button
            className="scene-fullscreen"
            onClick={() =>
              document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen()
            }
          >
            ⛶ 全屏专注
          </button>
        </header>
        <button className="rain-goal" onClick={onSettings}>
          <span className="goal-orbit">◎</span>
          <div>
            <small>{settings.goal.exam}</small>
            <strong>
              {settings.goal.school || "设定你的目标院校"}
              {settings.goal.score && <span> / {settings.goal.score} 分</span>}
            </strong>
          </div>
          <span className="rain-countdown">
            <strong>{countdown(settings.goal.date)}</strong>
            <small>
              {settings.goal.date ? "自设目标日" : "考试日尚未确定"}
            </small>
          </span>
          <span>↗</span>
        </button>
        <div className="rain-center">
          <p className="rain-state">
            <span />
            {running
              ? "专注中 · 正在积雨"
              : active
                ? "雨歇片刻 · 学习已暂停"
                : "准备开始一场专注"}
          </p>
          <div className="hero-time" data-testid="hero-time">
            {duration(snapshot.session?.effectiveMs ?? 0)}
          </div>
          <div className="rain-caption">
            {active
              ? `已完成目标的 ${Math.floor(progress * 100)}%${progress >= 1 ? " · 满盈之后，仍在积累" : ""}`
              : ""}
          </div>
          <div className="rain-actions">{controls}</div>
          {active ? (
            <div className="rain-session-note">
              {running
                ? `本次目标 ${duration(snapshot.session!.targetMs)}`
                : snapshot.pauseReasons.filter(Boolean).join("；") ||
                  "准备好时，再让雨落下。"}
            </div>
          ) : (
            <div className="rain-target">
              <span>专注目标</span>
              {[25, 45, 60].map((n) => (
                <button
                  key={n}
                  className={target === n ? "selected" : ""}
                  onClick={() => setTarget(n)}
                >
                  {n} 分钟
                </button>
              ))}
              <label>
                <input
                  aria-label="本次目标分钟"
                  type="number"
                  step="any"
                  min="0.017"
                  max="100000"
                  value={target}
                  onChange={(e) => setTarget(Number(e.target.value))}
                />
                分钟
              </label>
            </div>
          )}
        </div>
        <div
          className="rain-depth"
          aria-label={`本次积累 ${Math.floor(progress * 100)}%`}
        >
          <span>
            积<br />雨<br />深<br />度
          </span>
          <div className="depth-track">
            <i style={{ height: `${Math.min(progress, 1) * 100}%` }} />
          </div>
          <b>
            {Math.floor(progress * 100)}
            <small>%</small>
          </b>
        </div>
        <footer className="rain-footer">
          <div className="rain-stats">
            <div>
              <span>可用时长</span>
              <strong data-testid="balance">
                {duration(snapshot.balanceMs + pending)}
              </strong>
              <small>{pending ? "预计 · 含未保存时间" : ""}</small>
            </div>
            <div>
              <span>累计学习</span>
              <strong data-testid="earned">
                {duration(snapshot.earnedMs + pending)}
              </strong>
              <small>{pending ? "预计 · 含未保存时间" : ""}</small>
            </div>
            <div>
              <span>今日专注</span>
              <strong>{duration(snapshot.todayMs)}</strong>
            </div>
          </div>
          <div className="rain-save">
            <i />
            {snapshot.lastCheckpointAt
              ? `已保存至 ${new Date(snapshot.lastCheckpointAt).toLocaleTimeString("zh-CN")}`
              : "每约 5 秒自动保存"}
          </div>
        </footer>
      </div>
    </section>
  );
}
