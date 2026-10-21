import { z } from "zod";
export const MAX_MS = 8_000_000_000_000;
const id = z.string().uuid();
const text = z.string().trim().min(1).max(160);
const note = z.string().max(10000);
const empty = z.object({}).strict();
const page = z.object({
  offset: z.number().int().min(0).max(1000000).default(0),
});
export const appearanceSchema = z
  .object({
    theme: z.enum(["mist", "tea", "lake"]),
    icons: z.enum(["Lucide", "Phosphor", "Tabler"]),
    font: z.enum(["sans", "serif"]),
    fontSize: z.number().int().min(14).max(20),
    lowMotion: z.boolean(),
    quality: z.enum(["low", "medium", "high"]),
  })
  .strict();
export const goalSchema = z
  .object({
    exam: text,
    school: z.string().max(160),
    score: z.string().max(32),
    date: z
      .string()
      .refine(
        (s) =>
          s === "" ||
          (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
            new Date(s).toISOString().slice(0, 10) === s),
        "日期无效",
      ),
    targetMs: z.number().int().min(1000).max(MAX_MS),
  })
  .strict();
export const schemas = {
  getSnapshot: empty,
  startStudy: z
    .object({ targetMs: z.number().int().min(1000).max(MAX_MS) })
    .strict(),
  pauseStudy: empty,
  resumeStudy: empty,
  endStudy: z.object({ sessionId: id }).strict(),
  resolveRecovery: z.object({ action: z.enum(["resume", "end"]) }).strict(),
  retrySave: empty,
  listSessions: page,
  getSession: z.object({ id }),
  setSessionNote: z.object({ id, note }),
  getDailySummary: empty,
  setDailyReview: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note,
  }),
  listRewards: empty,
  saveReward: z
    .object({
      id: id.optional(),
      name: text,
      priceMs: z.number().int().positive().max(MAX_MS),
    })
    .strict(),
  archiveReward: z.object({ id }),
  prepareRedemption: z.object({ rewardId: id }),
  confirmRedemption: z.object({ intentId: id }),
  cancelRedemption: z.object({ intentId: id }),
  listRedemptions: page,
  getRedemptionIntent: empty,
  listCourses: empty,
  createCourse: z.object({ name: text }),
  deleteCourse: z.object({ id, removeResources: z.boolean().default(false) }),
  renameCourse: z.object({ id, name: text }),
  renameResource: z.object({ id, title: text }),
  moveResource: z.object({ id, courseId: id }),
  getWindowState: empty,
  setFocusFullscreen: z.object({ enabled: z.boolean() }).strict(),
  getStorageUsage: empty,
  previewCleanup: empty,
  runCleanup: empty,
  setStorageBudget: z.object({
    bytes: z
      .number()
      .int()
      .min(1024 ** 3)
      .max(1024 ** 4),
  }),
  cancelImport: z.object({ jobId: id }),
  getImportProgress: empty,
  importDroppedPaths: z.object({
    paths: z.array(z.string().min(1).max(32768)).max(100),
    courseId: id,
  }),
  listResources: page.extend({
    search: z.string().max(160).default(""),
    course: z.union([id, z.literal("uncategorized")]).optional(),
  }),
  saveLink: z.object({
    title: text,
    url: z
      .string()
      .url()
      .max(4096)
      .refine((s) => ["https:", "http:"].includes(new URL(s).protocol)),
    courseId: id.nullable(),
    note,
  }),
  chooseAndImportFiles: z.object({ courseId: id.nullable() }),
  openResource: z.object({ id }),
  deleteResource: z.object({ id }),
  getSettings: empty,
  updateGoal: goalSchema,
  updateAppearance: appearanceSchema,
  exportBackup: empty,
  inspectBackup: empty,
  restoreBackup: z.object({ token: id, confirmed: z.literal(true) }).strict(),
  openLicenses: empty,
} as const;
export type Method = keyof typeof schemas;
const nonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const storageUsageSchema = z.object({
  attachments: nonnegative,
  database: nonnegative,
  cache: nonnegative,
  temporary: nonnegative,
  backups: nonnegative,
  oldDatasets: nonnegative,
  reclaimable: nonnegative,
  budget: nonnegative,
});
export const importResultSchema = z.object({
  count: nonnegative,
  results: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["imported", "duplicate", "failed", "cancelled"]),
      reason: z.string().optional(),
    }),
  ),
});
export const windowStateSchema = z.object({
  fullscreen: z.boolean(),
  maximized: z.boolean(),
  minimized: z.boolean(),
});
export type WindowState = z.infer<typeof windowStateSchema>;
export const snapshotSchema = z.object({
  protocolVersion: z.literal(1),
  datasetId: id,
  processEpoch: id,
  snapshotSeq: nonnegative,
  dbRevision: nonnegative,
  emittedAtUtc: z.string(),
  phase: z.enum(["idle", "running", "paused", "recovery_pending", "ended"]),
  pauseReasons: z.array(z.string()),
  storage: z.enum(["ok", "saving", "error"]),
  session: z
    .object({
      id,
      targetMs: nonnegative,
      effectiveMs: nonnegative,
      committedMs: nonnegative,
    })
    .nullable(),
  earnedMs: nonnegative,
  balanceMs: nonnegative,
  pendingMs: nonnegative,
  todayMs: nonnegative,
  lastCheckpointAt: z.string().nullable(),
});
export const responseSchemas = {
  getSnapshot: snapshotSchema,
  getWindowState: windowStateSchema,
  setFocusFullscreen: windowStateSchema,
  listCourses: z.array(
    z.object({
      id,
      name: z.string(),
      normalized_name: z.string(),
      created_at: z.string(),
      sort_order: z.number().int(),
      resource_count: nonnegative,
    }),
  ),
  createCourse: z.object({ id }),
  renameCourse: z.null(),
  deleteCourse: z.null(),
  renameResource: z.null(),
  moveResource: z.null(),
  getStorageUsage: storageUsageSchema,
  previewCleanup: storageUsageSchema,
  runCleanup: storageUsageSchema,
  setStorageBudget: z.null(),
  cancelImport: z.null(),
  getImportProgress: z
    .object({
      jobId: id,
      name: z.string(),
      completed: nonnegative,
      total: nonnegative,
      bytes: nonnegative,
      active: z.boolean(),
    })
    .nullable(),
  importDroppedPaths: importResultSchema,
  chooseAndImportFiles: importResultSchema.nullable(),
} as const;
export type StorageUsage = z.infer<typeof storageUsageSchema>;
export type MethodValue<K extends Method> =
  K extends keyof typeof responseSchemas
    ? z.infer<(typeof responseSchemas)[K]>
    : any;
export function parseMethodValue(method: Method, value: unknown): unknown {
  const schema = (responseSchemas as Partial<Record<Method, z.ZodType>>)[
    method
  ];
  return schema ? schema.parse(value) : value;
}

export const readMethods: Method[] = [
  "listRewards",
  "listRedemptions",
  "getRedemptionIntent",
  "getWindowState",
  "getImportProgress",
  "getStorageUsage",
  "previewCleanup",
  "getSnapshot",
  "listSessions",
  "getSession",
  "getDailySummary",
  "listCourses",
  "listResources",
  "getSettings",
  "openResource",
  "inspectBackup",
  "openLicenses",
];
export type Envelope = {
  datasetId: string;
  operationId: string;
  payload: unknown;
};
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };
export type Appearance = z.infer<typeof appearanceSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Settings = { appearance: Appearance; goal: Goal };
export type Phase =
  "idle" | "running" | "paused" | "recovery_pending" | "ended";
export type Snapshot = {
  protocolVersion: 1;
  datasetId: string;
  processEpoch: string;
  snapshotSeq: number;
  dbRevision: number;
  emittedAtUtc: string;
  phase: Phase;
  pauseReasons: string[];
  storage: "ok" | "saving" | "error";
  session: null | {
    id: string;
    targetMs: number;
    effectiveMs: number;
    committedMs: number;
  };
  earnedMs: number;
  balanceMs: number;
  pendingMs: number;
  todayMs: number;
  lastCheckpointAt: string | null;
};
export type Bridge = {
  [K in Method]: (request: Envelope) => Promise<Result<MethodValue<K>>>;
} & {
  importDroppedFiles: (
    files: File[],
    courseId: string,
    operationId: string,
    datasetId: string,
  ) => Promise<Result<z.infer<typeof importResultSchema>>>;
  subscribeWindowState: (listener: (s: WindowState) => void) => () => void;
  subscribeSnapshot: (listener: (s: Snapshot) => void) => () => void;
};
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export const defaults: Settings = {
  appearance: {
    theme: "mist",
    icons: "Lucide",
    font: "sans",
    fontSize: 16,
    lowMotion: false,
    quality: "medium",
  },
  goal: {
    exam: "2027 年全国硕士研究生招生考试",
    school: "",
    score: "",
    date: "",
    targetMs: 3600000,
  },
};
export function duration(ms: number) {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export function countdown(date: string, now = new Date()) {
  if (!date) return "日期待设置";
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((Date.parse(date) - today) / 86400000);
  return days > 0
    ? `${days} 天`
    : days === 0
      ? "已到目标日"
      : `已过去 ${-days} 天`;
}
