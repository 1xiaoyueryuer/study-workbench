import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  shell,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readFile,
  mkdir,
  writeFile,
  copyFile,
  stat,
  utimes,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Datasets } from "./files";
import {
  schemas,
  type Method,
  type Envelope,
  DomainError,
} from "../shared/contracts";
app.setName("study-workbench");
if (process.env.STUDY_DATA_DIR)
  app.setPath("userData", process.env.STUDY_DATA_DIR);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window: BrowserWindow;
let data: Datasets;
let exiting = false;
let queue = Promise.resolve();
let blocked = false;
let suspended = false;
let systemLocked = false;
const serialize = <T>(fn: () => Promise<T> | T): Promise<T> => {
  const next = queue.then(fn);
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
};
const broadcast = () => {
  if (window && !window.isDestroyed())
    window.webContents.send("workbench:snapshot", data.store.snapshot());
};
const env = (payload: unknown = {}): Envelope => ({
  datasetId: data.store.datasetId,
  operationId: randomUUID(),
  payload,
});
async function openResource(id: string) {
  const r = data.resource(id);
  if (r.kind === "url") {
    const u = new URL(r.url);
    if (!["http:", "https:"].includes(u.protocol))
      throw new Error("链接协议不支持");
    await shell.openExternal(u.href);
    return;
  }
  const ext = r.extension;
  const mime =
    ext === ".pdf"
      ? "application/pdf"
      : (
          {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
          } as Record<string, string>
        )[ext];
  const viewDir = join(data.root, "view-cache", r.id);
  const viewPath = join(
    viewDir,
    `attachment${/^\.[a-z0-9]{1,12}$/.test(ext) ? ext : ".bin"}`,
  );
  const unpin = data.pinPreview(viewDir);
  try {
    const size = (await stat(r.path)).size;
    const cached = await stat(viewPath).catch(() => null);
    await data.trimCache(cached?.size === size ? 0 : size);
    await mkdir(viewDir, { recursive: true });
    if (cached?.size !== size) await copyFile(r.path, viewPath);
    const now = new Date();
    await utimes(viewDir, now, now);
  } catch (error) {
    unpin();
    throw error;
  }
  if (mime || [".txt", ".md", ".csv"].includes(ext)) {
    if (
      mime !== "application/pdf" &&
      (await stat(r.path)).size > 32 * 1024 ** 2
    ) {
      unpin();
      throw new Error("内置图片和文本预览上限为 32MB，请使用较小文件。");
    }
    const viewer = new BrowserWindow({
      width: 950,
      height: 750,
      title: r.title,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true,
      },
    });
    viewer.on("closed", () => {
      unpin();
      void data.trimCache();
    });
    viewer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    viewer.webContents.on("will-navigate", (e) => e.preventDefault());
    if (mime === "application/pdf") await viewer.loadFile(viewPath);
    else {
      const bytes = await readFile(r.path);
      const escaped = bytes
        .toString("utf8")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;");
      const html = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{background:#f6f4ed;color:#243a34;padding:32px;font:18px/1.8 sans-serif}pre{white-space:pre-wrap}img{max-width:100%}</style>${mime ? `<img src="data:${mime};base64,${bytes.toString("base64")}">` : `<pre>${escaped}</pre>`}`;
      await viewer.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
    }
    return;
  }
  try {
    const error = await shell.openPath(viewPath);
    if (error)
      throw new DomainError(
        "OPEN_FAILED",
        "系统未能打开此文件，请检查本机关联应用：" + error,
      );
  } finally {
    unpin();
  }
}
async function external(method: Method, req: Envelope) {
  const p = schemas[method].parse(req.payload) as any;
  if (req.datasetId !== data.store.datasetId)
    throw new DomainError("STALE_DATASET", "数据集已更换，请重新操作");
  if (!/^[a-f0-9-]{36}$/i.test(req.operationId))
    throw new Error("操作标识无效");
  switch (method) {
    case "openResource":
      await openResource(p.id);
      return null;
    case "chooseAndImportFiles": {
      if (data.store.storage === "error") throw new Error(data.store.lastError);
      const selected = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
      });
      if (selected.canceled) return null;
      return data.importFiles(selected.filePaths, p.courseId, req.operationId);
    }
    case "importDroppedPaths":
      return data.importFiles(p.paths, p.courseId, req.operationId);
    case "getStorageUsage":
    case "previewCleanup":
      return data.storageUsage();
    case "runCleanup":
      return data.cleanStorage(true);
    case "exportBackup": {
      const path = await dialog.showSaveDialog(window, {
        defaultPath: `积水书房-${new Date().toISOString().slice(0, 10)}.studybackup`,
        filters: [{ name: "学习备份", extensions: ["studybackup"] }],
      });
      if (path.canceled || !path.filePath) return null;
      return data.exportTo(path.filePath);
    }
    case "inspectBackup": {
      const selected = await dialog.showOpenDialog(window, {
        filters: [{ name: "学习备份", extensions: ["studybackup"] }],
        properties: ["openFile"],
      });
      if (selected.canceled) return null;
      return data.inspect(selected.filePaths[0]);
    }
    case "restoreBackup":
      return data.restore(p.token);
    case "openLicenses": {
      const viewer = new BrowserWindow({
        width: 850,
        height: 700,
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      await viewer.loadFile(join(__dirname, "../renderer/licenses.html"));
      return null;
    }
    default:
      return undefined;
  }
}
if (locked)
  void app.whenReady().then(async () => {
    try {
      data = new Datasets(app.getPath("userData"));
      await data.init();
      const url = pathToFileURL(join(__dirname, "../renderer/index.html")).href;
      window = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 680,
        backgroundColor: "#eef1e9",
        title: "积水书房",
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (e) => e.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
        cb(false),
      );
      ipcMain.handle(
        "workbench:command",
        (event, method: Method, request: Envelope) => {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame.url !== url ||
            !Object.hasOwn(schemas, method)
          )
            return {
              ok: false,
              error: {
                code: "INVALID_INPUT",
                message: "请求来源无效",
                retryable: false,
              },
            };
          if (method === "cancelImport" || method === "getImportProgress") {
            const parsed = schemas[method].safeParse(request.payload);
            if (!parsed.success || request.datasetId !== data.store.datasetId)
              return {
                ok: false,
                error: {
                  code: "STALE_DATASET",
                  message: "数据集或参数无效",
                  retryable: false,
                },
              };
            return {
              ok: true,
              value:
                method === "getImportProgress"
                  ? data.importProgress
                  : data.cancelImport((parsed.data as { jobId: string }).jobId),
            };
          }
          return serialize(async () => {
            if (
              event.sender !== window.webContents ||
              event.senderFrame !== window.webContents.mainFrame ||
              event.senderFrame.url !== url ||
              !Object.hasOwn(schemas, method)
            )
              return {
                ok: false,
                error: {
                  code: "INVALID_INPUT",
                  message: "请求来源无效",
                  retryable: false,
                },
              };
            try {
              if (
                (method === "resumeStudy" ||
                  (method === "resolveRecovery" &&
                    (request.payload as any)?.action === "resume")) &&
                (suspended || systemLocked)
              )
                throw new DomainError("INVALID_INPUT", "请先唤醒并解锁系统");
              blocked = method === "restoreBackup";
              if (
                [
                  "openResource",
                  "chooseAndImportFiles",
                  "importDroppedPaths",
                  "getStorageUsage",
                  "previewCleanup",
                  "runCleanup",
                  "exportBackup",
                  "inspectBackup",
                  "restoreBackup",
                  "openLicenses",
                ].includes(method)
              ) {
                const value = await external(method, request);
                broadcast();
                return { ok: true, value };
              }
              const result = data.store.command(method, request);
              if (
                ["deleteResource", "deleteCourse"].includes(method) &&
                result.ok
              )
                await data.cleanupAttachments();
              broadcast();
              return result;
            } catch (e) {
              return {
                ok: false,
                error: {
                  code:
                    e instanceof DomainError ? e.code : "STORAGE_UNAVAILABLE",
                  message: e instanceof Error ? e.message : String(e),
                  retryable: !(e instanceof DomainError),
                },
              };
            } finally {
              blocked = false;
            }
          });
        },
      );
      let ticks = 0;
      const interval = setInterval(() => {
        if (exiting) return;
        data.store.clock.sample();
        if (
          !blocked &&
          (++ticks % 20 === 0 ||
            (data.store.session?.state === "running" &&
              !data.store.clock.running))
        )
          data.store.checkpoint();
        broadcast();
      }, 250);
      powerMonitor.on("suspend", () => {
        suspended = true;
        data.store.systemPause("系统睡眠，请手动继续");
        broadcast();
      });
      powerMonitor.on("resume", () => {
        suspended = false;
      });
      powerMonitor.on("lock-screen", () => {
        systemLocked = true;
        data.store.systemPause("系统锁屏，请手动继续");
        broadcast();
      });
      powerMonitor.on("unlock-screen", () => {
        systemLocked = false;
      });
      window.on("close", (event) => {
        if (exiting) return;
        event.preventDefault();
        void serialize(async () => {
          if (data.store.session) {
            const result = data.store.command(
              data.store.storage === "error" ? "retrySave" : "endStudy",
              env(
                data.store.storage === "error"
                  ? {}
                  : { sessionId: data.store.session.id },
              ),
            );
            if (!result.ok) {
              const answer = await dialog.showMessageBox(window, {
                type: "error",
                message: "学习尾段尚未保存",
                detail: result.error.message,
                buttons: ["留下重试", "放弃未保存尾段并退出"],
                defaultId: 0,
                cancelId: 0,
              });
              if (answer.response === 0) return;
            } else if (data.store.session) {
              const end = data.store.command(
                "endStudy",
                env({ sessionId: data.store.session.id }),
              );
              if (!end.ok) return;
            }
          }
          clearInterval(interval);
          exiting = true;
          data.store.close();
          app.quit();
        });
      });
      app.on("second-instance", () => {
        if (window.isMinimized()) window.restore();
        window.focus();
      });
      await window.loadURL(url);
      if (process.env.STUDY_SMOKE_OUTPUT) {
        const output = process.env.STUDY_SMOKE_OUTPUT;
        const gpu = await app.getGPUInfo("complete");
        const webgl = await window.webContents.executeJavaScript(
          "Boolean(document.createElement('canvas').getContext('webgl2'))",
        );
        await mkdir(join(output, ".."), { recursive: true });
        await writeFile(
          output,
          JSON.stringify(
            {
              versions: process.versions,
              packaged: app.isPackaged,
              datasetId: data.store.datasetId,
              sqlite: data.store.db
                .prepare("SELECT sqlite_version() version")
                .get(),
              webgl,
              gpu,
            },
            null,
            2,
          ),
        );
      }
    } catch (e) {
      dialog.showErrorBox(
        "积水书房启动失败",
        `${e instanceof Error ? e.stack : e}\n原数据保留，未创建替代空库。`,
      );
      app.exit(1);
    }
  });
app.on("window-all-closed", () => {
  if (exiting) app.quit();
});
