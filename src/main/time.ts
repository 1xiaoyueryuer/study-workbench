import { MAX_MS } from "../shared/contracts";
export type Slice = { date: string; ms: number };
export const localDate = (wall: number) =>
  new Date(wall + 8 * 3600000).toISOString().slice(0, 10);
export function splitDays(start: number, ms: number): Slice[] {
  const out: Slice[] = [];
  while (ms > 0) {
    const midnight =
      Date.parse(localDate(start) + "T00:00:00+08:00") + 86400000;
    const n = Math.min(ms, midnight - start);
    out.push({ date: localDate(start), ms: n });
    start += n;
    ms -= n;
  }
  return out;
}
/** Monotonic nanoseconds own duration. Calendar anchors only own daily grouping. */
export class StudyClock {
  totalNs = 0n;
  lastNs = 0n;
  wall = 0;
  running = false;
  reason = "";
  slices: Slice[] = [];
  clockJumps = 0;
  constructor(
    public mono: () => bigint = () => process.hrtime.bigint(),
    public utc: () => number = () => Date.now(),
  ) {}
  get ms() {
    return Number(this.totalNs / 1_000_000n);
  }
  reset(committed = 0) {
    this.totalNs = BigInt(committed) * 1_000_000n;
    this.slices = [];
    this.running = false;
    this.reason = "";
  }
  resume() {
    this.lastNs = this.mono();
    this.wall = this.utc();
    this.running = true;
    this.reason = "";
  }
  sample() {
    if (!this.running) return;
    const n = this.mono();
    const delta = n - this.lastNs;
    this.lastNs = n;
    if (delta < 0n || delta > 2_000_000_000n) {
      this.running = false;
      this.reason = "检测到超过 2 秒的不确定空档，已暂停；空档未计入";
      return;
    }
    const before = this.ms;
    this.totalNs += delta;
    const gained = this.ms - before;
    if (this.ms > MAX_MS) {
      this.totalNs = BigInt(MAX_MS) * 1_000_000n;
      this.running = false;
      this.reason = "已达到安全计时上限";
      return;
    }
    for (const s of splitDays(this.wall, gained)) {
      const last = this.slices.at(-1);
      if (last?.date === s.date) last.ms += s.ms;
      else this.slices.push(s);
    }
    const predicted = this.wall + gained;
    const actual = this.utc();
    if (Math.abs(actual - predicted) > 2000) {
      this.clockJumps++;
      this.wall = actual;
    } else this.wall = predicted;
  }
  pause(reason = "手动暂停") {
    this.sample();
    this.running = false;
    this.reason = reason;
  }
}
