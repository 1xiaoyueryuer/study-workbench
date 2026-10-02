import { Button } from "../components/ui";
import { Storage } from "./Storage";
import type { Settings as SettingsData, Method } from "../../shared/contracts";
import type { FormSubmit } from "./Records";
import type { PageActions } from "./Shop";
export type BackupPreview = {
  token: string;
  createdAt: string;
  sessionCount: number;
  resourceCount: number;
  earnedMs: number;
};
const field = (f: FormData, name: string) => String(f.get(name) ?? "");
export function Settings({
  settings,
  call,
  run,
  busy,
  submit,
  mutate,
  setNotice,
  setTarget,
  setBackup,
}: PageActions & {
  settings: SettingsData;
  submit: FormSubmit;
  mutate: (m: Method, p?: unknown) => Promise<void>;
  setNotice: (s: string) => void;
  setTarget: (n: number) => void;
  setBackup: (b: BackupPreview | null) => void;
}) {
  return (
    <>
      <h1 className="page-heading">设置</h1>
      <Storage call={call} run={run} busy={busy} />
      <div className="two-columns">
        <section className="panel">
          <h2>目标设置</h2>
          <form
            className="form"
            key={JSON.stringify(settings.goal)}
            onSubmit={submit(async (f) => {
              await mutate("updateGoal", {
                exam: field(f, "exam"),
                school: field(f, "school"),
                score: field(f, "score"),
                date: field(f, "date"),
                targetMs: Number(f.get("minutes")) * 60000,
              });
              setTarget(Number(f.get("minutes")));
              setNotice("目标已保存；本次学习仍使用开始时的目标");
            })}
          >
            <label>
              目标考试
              <input
                name="exam"
                defaultValue={settings.goal.exam}
                required
                maxLength={160}
              />
            </label>
            <label>
              目标院校
              <input
                name="school"
                defaultValue={settings.goal.school}
                maxLength={160}
              />
            </label>
            <div className="form-row">
              <label>
                目标分数
                <input
                  name="score"
                  defaultValue={settings.goal.score}
                  maxLength={32}
                />
              </label>
              <label>
                自设目标日
                <input
                  name="date"
                  type="date"
                  defaultValue={settings.goal.date}
                />
              </label>
            </div>
            <label>
              默认专注目标（分钟）
              <input
                name="minutes"
                type="number"
                min="1"
                max="100000"
                defaultValue={settings.goal.targetMs / 60000}
              />
            </label>
            <small>具体考试日尚未确定，设定日期仅作为个人目标。</small>
            <Button disabled={busy}>保存目标</Button>
          </form>
        </section>
        <section className="panel">
          <h2>外观与体验</h2>
          <div className="theme-options">
            {[
              ["mist", "山雾书房"],
              ["tea", "杏茶手帖"],
              ["lake", "湖蓝晨光"],
            ].map(([id, name]) => (
              <button
                key={id}
                aria-pressed={settings.appearance.theme === id}
                className={`theme-choice ${id}`}
                onClick={() =>
                  void run(() =>
                    mutate("updateAppearance", {
                      ...settings.appearance,
                      theme: id,
                    }),
                  )
                }
              >
                <span />
                <strong>{name}</strong>
                {settings.appearance.theme === id && " ✓"}
              </button>
            ))}
          </div>
          <form
            className="form"
            key={JSON.stringify(settings.appearance)}
            onSubmit={submit(async (f) => {
              await mutate("updateAppearance", {
                ...settings.appearance,
                icons: field(f, "icons"),
                font: field(f, "font"),
                fontSize: Number(f.get("size")),
                quality: field(f, "quality"),
                lowMotion: f.get("lowMotion") === "on",
              });
              setNotice("外观已保存");
            })}
          >
            <div className="form-row">
              <label>
                图标
                <select name="icons" defaultValue={settings.appearance.icons}>
                  <option>Lucide</option>
                  <option>Phosphor</option>
                  <option>Tabler</option>
                </select>
              </label>
              <label>
                字体
                <select name="font" defaultValue={settings.appearance.font}>
                  <option value="sans">清晰黑体</option>
                  <option value="serif">人文宋体</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                字号
                <select name="size" defaultValue={settings.appearance.fontSize}>
                  {[14, 16, 18, 20].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                3D 画质
                <select
                  name="quality"
                  defaultValue={settings.appearance.quality}
                >
                  <option value="low">低 · 节能</option>
                  <option value="medium">中 · 平衡</option>
                  <option value="high">高 · 细腻</option>
                </select>
              </label>
            </div>
            <label className="checkbox">
              <input
                name="lowMotion"
                type="checkbox"
                defaultChecked={settings.appearance.lowMotion}
              />
              低动态模式
            </label>
            <small>保留真实玻璃与水位，关闭逐秒运动与强溢流。</small>
            <Button disabled={busy}>保存外观</Button>
          </form>
        </section>
        <section className="panel">
          <h2>备份与恢复</h2>
          <p className="muted">
            完整备份包含账本、设置与导入附件。备份会暂停计时，完成后请手动继续。
          </p>
          <div className="button-row">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await call("exportBackup");
                  if (r) setNotice("完整备份已保存：" + r.path);
                })
              }
            >
              导出备份
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => setBackup(await call("inspectBackup")))
              }
            >
              检查并恢复备份
            </Button>
          </div>
          <p className="note muted">
            异常退出仅恢复最近成功检查点；未保存尾段可能丢失。睡眠、锁屏或超过 2
            秒的采样空档会暂停，不自动补记。
          </p>
        </section>
        <section className="panel">
          <h2>关于积水书房</h2>
          <p>离线桌面工作台 · 0.4.0</p>
          <p className="muted">真实时间，真实积累。无账号、无云端上传。</p>
          <button
            className="text-button"
            onClick={() =>
              void run(async () => {
                await call("openLicenses");
              })
            }
          >
            查看第三方许可 ↗
          </button>
        </section>
      </div>
    </>
  );
}
