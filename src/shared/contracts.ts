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
      pricePoints: z
        .number()
        .int()
        .positive()
        .max(MAX_MS / 1000),
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
  quoteTimeConversion: z.object({
    points: z
      .number()
      .int()
      .positive()
      .max(Math.floor(MAX_MS / 60000)),
  }),
  confirmTimeConversion: z.object({ intentId: id }),
  listPointTransactions: page,
  getCollection: empty,
  getUnseenLoot: empty,
  acknowledgeLoot: z.object({ sequence: z.number().int().min(0).max(MAX_MS) }),
  getInventory: empty,
  placeCollectible: z.object({ id, tankIndex: z.number().int().min(0).max(5) }),
  returnCollectible: z.object({ id }),
  quoteSale: z.object({
    ids: z
      .array(id)
      .min(1)
      .max(50)
      .refine((a) => new Set(a).size === a.length),
  }),
  confirmSale: z.object({ intentId: id }),
  dismissMigrationNotice: empty,
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
export const collectibleSchema = z.object({
  id,
  catalog_id: z.string(),
  rarity_snapshot: z.number().int().min(0).max(5),
  sell_points_snapshot: nonnegative,
  state: z.enum(["warehouse", "display", "sold"]),
  slot_index: z.number().int().min(0).max(49).nullable(),
  tank_index: z.number().int().min(0).max(5).nullable(),
  drop_event_id: nonnegative,
  created_at: z.string(),
});
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
const conversionSchema = z.object({
  id,
  points: nonnegative,
  timeMs: nonnegative,
});
export const responseSchemas = {
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
  quoteTimeConversion: conversionSchema,
  confirmTimeConversion: conversionSchema,
  getCollection: z.array(collectibleSchema),
  getInventory: z.array(collectibleSchema),
  getUnseenLoot: z.object({
    count: nonnegative,
    latest: z
      .object({
        sequence: nonnegative,
        catalog_id: z.string(),
        rarity_snapshot: z.number().int().min(0).max(5),
      })
      .optional(),
  }),
  acknowledgeLoot: z.null(),
  placeCollectible: z.null(),
  returnCollectible: z.null(),
  dismissMigrationNotice: z.null(),
  quoteSale: z.object({ id, points: nonnegative, count: nonnegative }),
  confirmSale: z.object({ id, points: nonnegative }),
  listPointTransactions: z.array(
    z.object({
      id,
      amount: z.number().int(),
      kind: z.enum(["conversion", "sale", "purchase"]),
      conversion_id: id.nullable(),
      sale_id: id.nullable(),
      redemption_id: id.nullable(),
      created_at: z.string(),
    }),
  ),
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
  "getImportProgress",
  "getUnseenLoot",
  "getCollection",
  "getInventory",
  "listPointTransactions",
  "getStorageUsage",
  "previewCleanup",
  "getSnapshot",
  "listSessions",
  "getSession",
  "getDailySummary",
  "listRewards",
  "listRedemptions",
  "getRedemptionIntent",
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
  pointsBalance: number;
  inventoryCount: number;
  displayCount: number;
  lootBlockedByCapacity: boolean;
  latestLootEvent: number;
  migrationNotice: boolean;
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
