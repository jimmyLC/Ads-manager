// 日期區間預設（比照 Meta：今天／昨天／近 7 天…）。日界與計數器一致用 UTC。
export const PRESETS = {
  today: "今天", yesterday: "昨天", last_7d: "過去 7 天", last_14d: "過去 14 天", last_30d: "過去 30 天",
  this_month: "這個月", last_month: "上個月", lifetime: "全部期間",
} as const;
export type Preset = keyof typeof PRESETS;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface DateRange { from: string; to: string; preset: Preset | "custom"; label: string }

export function presetRange(p: Preset, now = new Date()): { from: string; to: string } {
  const day = (n: number) => ymd(new Date(now.getTime() - n * 86400_000));
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  switch (p) {
    case "today": return { from: day(0), to: day(0) };
    case "yesterday": return { from: day(1), to: day(1) };
    case "last_7d": return { from: day(6), to: day(0) };
    case "last_14d": return { from: day(13), to: day(0) };
    case "last_30d": return { from: day(29), to: day(0) };
    case "this_month": return { from: ymd(new Date(Date.UTC(y, m, 1))), to: day(0) };
    case "last_month": return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
    case "lifetime": return { from: "2000-01-01", to: day(0) };
  }
}

/** 從 searchParams 取區間：?range=<preset> 或 ?from=&to=；不合法就回預設（過去 7 天）。 */
export function readRange(sp: { range?: string; from?: string; to?: string }, fallback: Preset = "last_7d"): DateRange {
  if (sp.from && sp.to && DAY.test(sp.from) && DAY.test(sp.to) && sp.from <= sp.to)
    return { from: sp.from, to: sp.to, preset: "custom", label: `${sp.from} – ${sp.to}` };
  const p = (sp.range && sp.range in PRESETS ? sp.range : fallback) as Preset;
  return { ...presetRange(p), preset: p, label: PRESETS[p] };
}
