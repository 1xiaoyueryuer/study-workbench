import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  schemas,
  parseMethodValue,
  type Result,
  type Method,
  type Snapshot,
  type Envelope,
} from "../shared/contracts";
async function invoke(method: Method, request: Envelope) {
  const result: Result<unknown> = await ipcRenderer.invoke(
    "workbench:command",
    method,
    request,
  );
  return result.ok
    ? { ok: true, value: parseMethodValue(method, result.value) }
    : result;
}
const api = Object.fromEntries(
  (Object.keys(schemas) as Method[])
    .filter((method) => method !== "importDroppedPaths")
    .map((method) => [method, (request: Envelope) => invoke(method, request)]),
);
contextBridge.exposeInMainWorld("workbench", {
  ...api,
  importDroppedFiles: (
    files: File[],
    courseId: string,
    operationId: string,
    datasetId: string,
  ) => {
    const paths = files.map((file) => webUtils.getPathForFile(file));
    if (paths.some((p) => !p))
      return Promise.resolve({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "请拖入磁盘上的真实文件，或使用添加资料",
          retryable: false,
        },
      });
    return invoke("importDroppedPaths", {
      datasetId,
      operationId,
      payload: { paths, courseId },
    });
  },
  subscribeSnapshot: (listener: (s: Snapshot) => void) => {
    const handler = (_: unknown, s: Snapshot) => listener(s);
    ipcRenderer.on("workbench:snapshot", handler);
    return () => ipcRenderer.removeListener("workbench:snapshot", handler);
  },
});
