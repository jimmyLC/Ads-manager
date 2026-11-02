import { getDb } from "./db.ts";
import { creativeReady } from "./creatives.ts";
import { signAssetToken } from "./secret.ts";

export const DEVICES = ["desktop", "mobile", "tablet", "unknown"] as const;
export const normCountry = (c?: string | null) => (c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : "XX");
export const normDevice = (d?: string | null) => ((DEVICES as readonly string[]).includes(d ?? "") ? d! : "unknown");
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

const setting = (key: string, fallback: string) =>
  (getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? fallback;

/** 以指定時區取得本地小時（0..23）與 ISO 星期（1=週一…7=週日）。 */
export function localParts(d: Date, tz: string): { hour: number; weekday: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(d);
  const hour = Number(p.find((x) => x.type === "hour")!.value);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.find((x) => x.type === "weekday")!.value) + 1;
  return { hour, weekday };
}

interface Rule { dimension: string; operator: string; value: string }
interface Ctx { country: string; device: string; placement: string; hour: number; weekday: number }

function rulePasses(r: Rule, ctx: Ctx): boolean {
  const actual = String({ country: ctx.country, device: ctx.device, placement: ctx.placement, hour: ctx.hour, weekday: ctx.weekday }[r.dimension] ?? "");
  if (r.dimension === "path") return true; // 保留欄位，v1 不判定
  if (r.dimension === "country" && ctx.country === "XX") return false; // 未知國別：寧可不投
  const norm = (s: string) => (r.dimension === "country" ? s.trim().toUpperCase() : s.trim());
  const list = r.value.split(",").map(norm);
  const hit = list.includes(norm(actual));
  if (r.operator === "in" || r.operator === "equals") return hit;
  if (r.operator === "not_in") return !hit;
  return false; // 未知運算子一律排除
}

export interface ServeOptions { now?: Date; rng?: () => number; ttlSeconds?: number }
export type ServeResult =
  | { status: 200; body: { ok: true; ad: unknown } | { ok: false; reason: "no_eligible_ad" } }
  | { status: 404; body: { ok: false; reason: "unknown_placement" } };

export function serve(input: { site: string; slot: string; country?: string | null; device?: string | null }, opts: ServeOptions = {}): ServeResult {
  const db = getDb();
  const d = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;
  const nowSec = Math.floor(d.getTime() / 1000);
  const placementId = `${input.site}:${input.slot}`;
  const pl = db.prepare("SELECT * FROM placements WHERE id = ? AND site_id = ? AND status = 'active'").get(placementId, input.site) as
    | { id: string; width_desktop: number; height_desktop: number; aspect: string } | undefined;
  if (!pl) return { status: 404, body: { ok: false, reason: "unknown_placement" } };

  const country = normCountry(input.country), device = normDevice(input.device);
  const ctx: Ctx = { country, device, placement: placementId, ...localParts(d, setting("targeting_timezone", "Asia/Taipei")) };
  const today = utcDay(d);
  const defaultCap = Number(setting("daily_impression_cap_default", "0")) || null;

  const camps = db.prepare(
    `SELECT c.* FROM campaigns c JOIN campaign_placements cp ON cp.campaign_id = c.id
     WHERE cp.placement_id = ? AND c.status = 'active'
       AND (c.starts_at IS NULL OR c.starts_at <= ?) AND (c.ends_at IS NULL OR c.ends_at >= ?)`,
  ).all(placementId, nowSec, nowSec) as unknown as {
    id: string; weight: number; daily_impression_cap: number | null; target_impression: number | null; target_click: number | null;
  }[];

  const eligible = camps.filter((c) => {
    const rules = db.prepare("SELECT dimension, operator, value FROM targeting_rules WHERE campaign_id = ?").all(c.id) as unknown as Rule[];
    if (!rules.every((r) => rulePasses(r, ctx))) return false;
    const tot = db.prepare("SELECT COALESCE(SUM(impressions),0) i, COALESCE(SUM(clicks),0) k FROM ad_counters WHERE campaign_id = ?").get(c.id) as { i: number; k: number };
    if (c.target_impression != null && tot.i >= c.target_impression) return false; // 目標值以累計計
    if (c.target_click != null && tot.k >= c.target_click) return false;
    const cap = c.daily_impression_cap ?? defaultCap;
    if (cap != null) {
      const day = db.prepare("SELECT COALESCE(SUM(impressions),0) i FROM ad_counters WHERE campaign_id = ? AND day = ?").get(c.id, today) as { i: number };
      if (day.i >= cap) return false;
    }
    return true;
  });

  // 加權抽籤；活動沒有可用素材時退到下一個，直到抽到有素材者
  const pool = [...eligible];
  while (pool.length) {
    const total = pool.reduce((s, c) => s + Math.min(10, Math.max(1, c.weight)), 0);
    let r = rng() * total, idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= Math.min(10, Math.max(1, pool[idx].weight));
      if (r < 0) break;
    }
    const camp = pool.splice(idx, 1)[0];
    const creatives = (db.prepare("SELECT * FROM creatives WHERE campaign_id = ? AND status = 'active'").all(camp.id) as unknown as {
      id: string; kind: string; name: string; alt_text: string | null; headline: string | null; body: string | null; cta_label: string | null;
      cta_url: string | null; html: string | null; logo_asset_id: string | null; thumb_asset_id: string | null;
    }[]).filter((c) => c.cta_url && creativeReady(c, placementId));
    if (!creatives.length) continue;
    const cr = creatives[Math.min(creatives.length - 1, Math.floor(rng() * creatives.length))];

    const ttl = opts.ttlSeconds ?? (Number(setting("asset_token_ttl_seconds", "600")) || 600);
    const assetUrl = (id: string, v: string) => `/api/promo/img/${id}?d=${v}&t=${signAssetToken(id, ttl, nowSec)}`;
    const assets = db.prepare("SELECT id, variant FROM creative_assets WHERE creative_id = ? AND placement_id = ?").all(cr.id, placementId) as { id: string; variant: string }[];
    const byVar = Object.fromEntries(assets.map((a) => [a.variant, a.id]));
    const side = (v: "desktop" | "mobile") => byVar[v] && {
      asset_id: byVar[v], url: assetUrl(byVar[v], v), ...(byVar[`${v}@2x`] ? { url_2x: assetUrl(byVar[`${v}@2x`], `${v}@2x`) } : {}),
    };
    const nativeAsset = (id: string | null) => (id ? assetUrl(id, "native") : null);

    // 計曝光：計數失敗不得影響投放（SPEC §9）
    try {
      db.prepare(
        `INSERT INTO ad_counters (day, campaign_id, creative_id, placement_id, country, device, impressions) VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (day, campaign_id, creative_id, placement_id, country, device) DO UPDATE SET impressions = impressions + 1`,
      ).run(today, camp.id, cr.id, placementId, country, device);
    } catch (e) {
      console.warn("impression_count_failed", e);
    }

    const trackers = (db.prepare("SELECT id FROM trackers WHERE campaign_id = ?").all(camp.id) as { id: string }[]).map((t) => t.id);
    return {
      status: 200,
      body: {
        ok: true,
        ad: {
          id: cr.id, campaign_id: camp.id, kind: cr.kind, name: cr.name, alt: cr.alt_text,
          width: pl.width_desktop, height: pl.height_desktop, aspect: pl.aspect,
          image: cr.kind === "image" ? { desktop: side("desktop"), mobile: side("mobile") } : null,
          native: cr.kind === "native"
            ? { headline: cr.headline, body: cr.body, cta_label: cr.cta_label, cta_url: `/api/promo/out/${cr.id}?d=desktop`, logo_url: nativeAsset(cr.logo_asset_id), thumb_url: nativeAsset(cr.thumb_asset_id) }
            : null,
          html: cr.kind === "html" ? cr.html : null,
          link: { desktop: `/api/promo/out/${cr.id}?d=desktop`, mobile: `/api/promo/out/${cr.id}?d=mobile` },
          trackers,
        },
      },
    };
  }
  return { status: 200, body: { ok: false, reason: "no_eligible_ad" } };
}
