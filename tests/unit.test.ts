import { describe, it, expect } from "vitest";
import { StudyClock, splitDays } from "../src/main/time";
import { countdown, schemas, parseMethodValue } from "../src/shared/contracts";
describe("monotonic study time", () => {
  it("preserves fractional milliseconds across pause and checkpoints", () => {
    let n = 0n;
    const clock = new StudyClock(
      () => n,
      () => 0,
    );
    clock.resume();
    n = 600500000n;
    clock.pause();
    expect(clock.ms).toBe(600);
    clock.resume();
    n += 599500000n;
    clock.sample();
    expect(clock.ms).toBe(1200);
  });
  it("discards ambiguous gaps and requires manual resume", () => {
    let n = 0n;
    const c = new StudyClock(
      () => n,
      () => 0,
    );
    c.resume();
    n += 1_000_000_000n;
    c.sample();
    n += 3_000_000_000n;
    c.sample();
    expect(c.ms).toBe(1000);
    expect(c.running).toBe(false);
    expect(c.reason).toContain("空档");
  });
  it("calendar jumps do not affect income", () => {
    let n = 0n,
      w = 0;
    const c = new StudyClock(
      () => n,
      () => w,
    );
    c.resume();
    n += 1000000000n;
    w += 86400000;
    c.sample();
    expect(c.ms).toBe(1000);
    expect(c.clockJumps).toBe(1);
  });
  it("splits Shanghai midnight exactly", () => {
    expect(
      splitDays(Date.parse("2026-09-29T23:59:59.500+08:00"), 1200),
    ).toEqual([
      { date: "2026-09-29", ms: 500 },
      { date: "2026-09-30", ms: 700 },
    ]);
  });
  it("does not invent an exam date", () => {
    expect(countdown("")).toBe("日期待设置");
    expect(countdown("2026-09-29", new Date(2026, 8, 29))).toBe("已到目标日");
    expect(countdown("2026-09-28", new Date(2026, 8, 29))).toBe("已过去 1 天");
  });
  it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER, Infinity])(
    "rejects unsafe reward price %s",
    (pricePoints) => {
      expect(
        schemas.saveReward.safeParse({ name: "休息", pricePoints }).success,
      ).toBe(false);
    },
  );
});

it("new IPC responses reject invalid money and storage values", () => {
  expect(() =>
    parseMethodValue("confirmSale", {
      id: "00000000-0000-4000-8000-000000000001",
      points: 1.5,
    }),
  ).toThrow();
  expect(() =>
    parseMethodValue("getStorageUsage", { attachments: -1 }),
  ).toThrow();
  expect(
    parseMethodValue("importDroppedPaths", {
      count: 0,
      results: [{ name: "重复.pdf", status: "duplicate" }],
    }),
  ).toEqual({ count: 0, results: [{ name: "重复.pdf", status: "duplicate" }] });
});
