import { getDb } from "./db.ts";

/** 維度 → 輸出欄位與 SQL 表達式（全部寫死白名單，使用者輸入絕不拼進 SQL）。 */
const DIMS = {
  day: { cols: ["day"], sel: "n.day AS day", grp: "n.day" },
  site: { cols: ["site"], sel: "CASE WHEN instr(n.placement_id, ':') > 0 THEN substr(n.placement_id, 1, instr(n.placement_id, ':') - 1) ELSE 'unknown' END AS site", grp: "site" },
  placement: { cols: ["placement"], sel: "n.placement_id AS placement", grp: "n.placement_id" },
  campaign: { cols: ["campaign_id", "campaign_name", "advertiser_name"], sel: "n.campaign_id AS campaign_id, c.name AS campaign_name, a.name AS advertiser_name", grp: "n.campaign_id" },
  creative: { cols: ["creative_id", "creative_name"], sel: "n.creative_id AS creative_id, cr.name AS creative_name", grp: "n.creative_id" },
  country: { cols: ["country"], sel: "n.country AS country", grp: "n.country" },
  device: { cols: ["device"], sel: "n.device AS device", grp: "n.device" },
} as const;
export type Dim = keyof typeof DIMS;
export const DIM_NAMES = Object.keys(DIMS) as Dim[];

export const COLUMNS = [
  "day", "site", "placement", "campaign_id", "campaign_name", "creative_id", "creative_name", "advertiser_name", "country", "device",
  "impressions", "clicks", "conversions", "ctr", "cvr", "value", "ecpm", "currency",
] as const;

export interface StatsQuery {
  from: string; to: string; groupBy: Dim[];
  site?: string; campaign_id?: string; placement_id?: string; country?: string; device?: string;
}
export type StatsRow = Record<(typeof COLUMNS)[number], string | number>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseQuery(q: URLSearchParams): { ok: true; value: StatsQuery } | { ok: false; reason: string } {
  const from = q.get("from") ?? "", to = q.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return { ok: false, reason: "bad_date" };
  if (from > to) return { ok: false, reason: "bad_date_range" };
  const raw = (q.get("groupBy") ?? "day,campaign,placement").split(",").map((s) => s.trim()).filter(Boolean);
  if (!raw.every((g) => g in DIMS)) return { ok: false, reason: "bad_group_by" };
  const groupBy = [...new Set(raw)] as Dim[];
  const f = (k: string) => q.get(k) || undefined;
  return { ok: true, value: { from, to, groupBy, site: f("site"), campaign_id: f("campaign_id"), placement_id: f("placement_id"), country: f("country")?.toUpperCase(), device: f("device") } };
}

function build(q: StatsQuery): { sql: string; params: string[] } {
  const where = ["n.day >= ?", "n.day <= ?"], params: string[] = [q.from, q.to];
  const eq = (col: string, v?: string) => { if (v) { where.push(`${col} = ?`); params.push(v); } };
  eq("n.campaign_id", q.campaign_id); eq("n.placement_id", q.placement_id); eq("n.country", q.country); eq("n.device", q.device);
  if (q.site) { where.push("n.placement_id LIKE ? ESCAPE '\\'"); params.push(q.site.replace(/[\\%_]/g, "\\$&") + ":%"); }

  const sels = q.groupBy.map((g) => DIMS[g].sel);
  const grps = q.groupBy.map((g) => DIMS[g].grp);
  const metrics = `SUM(n.impressions) AS impressions, SUM(n.clicks) AS clicks, SUM(n.conversions) AS conversions,
    SUM(CASE c.revenue_type WHEN 'cpm' THEN c.revenue / 1000.0 * n.impressions WHEN 'cpc' THEN c.revenue * n.clicks WHEN 'cpa' THEN c.revenue * n.conversions ELSE 0 END) AS value,
    COALESCE(MIN(c.currency), 'TWD') AS currency`;
  const sql = `SELECT ${[...sels, metrics].join(", ")}
    FROM ad_counters n
    LEFT JOIN campaigns c ON c.id = n.campaign_id
    LEFT JOIN advertisers a ON a.id = c.advertiser_id
    LEFT JOIN creatives cr ON cr.id = n.creative_id
    WHERE ${where.join(" AND ")}
    ${grps.length ? `GROUP BY ${grps.join(", ")}` : ""}
    ORDER BY ${grps.length ? grps.join(", ") : "1"}`;
  return { sql, params };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function finish(r: Record<string, unknown>): StatsRow {
  const imp = Number(r.impressions) || 0, clk = Number(r.clicks) || 0, cv = Number(r.conversions) || 0, value = Number(r.value) || 0;
  const out = {} as StatsRow;
  for (const c of COLUMNS) out[c] = (r[c] as string | number | null | undefined) ?? "";
  Object.assign(out, {
    impressions: imp, clicks: clk, conversions: cv,
    ctr: imp ? round(clk / imp, 4) : 0, cvr: clk ? round(cv / clk, 4) : 0,
    value: round(value, 2), ecpm: imp ? round((value / imp) * 1000, 2) : 0,
  });
  return out;
}

export function runStats(q: StatsQuery, limit?: number): StatsRow[] {
  const { sql, params } = build(q);
  const rows = getDb().prepare(limit ? `${sql} LIMIT ${Math.floor(limit)}` : sql).all(...params);
  return rows.map(finish);
}

export function* iterateStats(q: StatsQuery): Generator<StatsRow> {
  const { sql, params } = build(q);
  for (const r of getDb().prepare(sql).iterate(...params)) yield finish(r);
}

export function countStats(q: StatsQuery): number {
  const { sql, params } = build(q);
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as { n: number }).n;
}

export function totals(q: StatsQuery): StatsRow {
  return runStats({ ...q, groupBy: [] })[0] ?? finish({});
}
