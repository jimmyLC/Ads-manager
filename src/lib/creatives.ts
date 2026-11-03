import { randomBytes } from "node:crypto";
import { getDb, now } from "./db.ts";
import type { Result } from "./campaigns.ts";

export interface NewCreative {
  campaign_id: string; kind: string; name: string; alt_text?: string; cta_url?: string;
  headline?: string; body?: string; cta_label?: string; html?: string;
}

const httpsUrl = (u?: string) => { try { return new URL(u ?? "").protocol === "https:"; } catch { return false; } };

export function createCreative(input: NewCreative, actor: string, actorRole: string): Result<string> {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM campaigns WHERE id = ?").get(input.campaign_id)) return { ok: false, reason: "campaign_not_found" };
  if (!["image", "native", "html"].includes(input.kind)) return { ok: false, reason: "bad_kind" };
  if (!input.name.trim()) return { ok: false, reason: "name_required" };
  if (input.kind === "html" && actorRole !== "admin") return { ok: false, reason: "html_admin_only" };
  if (!httpsUrl(input.cta_url)) return { ok: false, reason: "cta_url_must_be_https" };
  if (input.kind === "image" && !input.alt_text?.trim()) return { ok: false, reason: "alt_required" };
  if (input.kind === "native") {
    const { headline = "", body = "", cta_label = "", alt_text = "" } = input;
    if (!headline || headline.length > 60) return { ok: false, reason: "headline_1_60" };
    if (!body || body.length > 140) return { ok: false, reason: "body_1_140" };
    if (!cta_label || cta_label.length > 20) return { ok: false, reason: "cta_label_1_20" };
    if (!alt_text.trim()) return { ok: false, reason: "alt_required" };
  }
  if (input.kind === "html" && !input.html?.trim()) return { ok: false, reason: "html_required" };

  const id = "cr_" + randomBytes(5).toString("hex");
  const t = now();
  db.prepare(
    `INSERT INTO creatives (id, campaign_id, kind, name, status, alt_text, headline, body, cta_label, cta_url, html,
                            created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.campaign_id, input.kind, input.name.trim(), input.alt_text ?? null, input.headline ?? null, input.body ?? null,
    input.cta_label ?? null, input.cta_url ?? null, input.html ?? null, t, t, actor, actor);
  db.prepare("INSERT INTO audit_log (ts, actor, action, object_type, object_id, detail) VALUES (?, ?, 'create', 'creative', ?, ?)")
    .run(t, actor, id, JSON.stringify({ campaign: input.campaign_id, kind: input.kind, name: input.name }));
  return { ok: true, value: id };
}

/** 此素材在該版位是否齊備可投（SPEC §4 步驟 5）。 */
export function creativeReady(c: { id: string; kind: string; html: string | null; logo_asset_id: string | null; thumb_asset_id: string | null }, placementId: string): boolean {
  if (c.kind === "html") return !!c.html?.trim();
  if (c.kind === "native") return !!(c.logo_asset_id || c.thumb_asset_id);
  const v = getDb().prepare("SELECT variant FROM creative_assets WHERE creative_id = ? AND placement_id = ?").all(c.id, placementId) as { variant: string }[];
  const have = new Set(v.map((r) => r.variant));
  return have.has("desktop") && have.has("mobile");
}
