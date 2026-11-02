import { randomBytes } from "node:crypto";
import { getDb, now } from "./db.ts";

export interface CampaignRow {
  id: string; name: string; status: string; weight: number; revenue: number; currency: string;
  starts_at: number | null; ends_at: number | null; daily_impression_cap: number | null;
  advertiser_name: string; placements: string | null;
}

export function listCampaigns(): CampaignRow[] {
  return getDb()
    .prepare(
      `SELECT c.*, a.name AS advertiser_name,
              (SELECT group_concat(placement_id, ', ') FROM campaign_placements WHERE campaign_id = c.id) AS placements
       FROM campaigns c JOIN advertisers a ON a.id = c.advertiser_id ORDER BY c.created_at DESC, c.id`,
    )
    .all() as unknown as CampaignRow[];
}

export function cpmFloor(): number {
  const r = getDb().prepare("SELECT value FROM settings WHERE key = 'cpm_floor_twd'").get() as { value: string } | undefined;
  return Number(r?.value ?? 30);
}

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface NewCampaign { name: string; placement_ids: string[]; weight: number; revenue?: number; starts_at?: number; ends_at?: number; daily_impression_cap?: number }

export function createCampaign(input: NewCampaign, actor: string): Result<string> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) return { ok: false, reason: "name_required" };
  const weight = Math.min(10, Math.max(1, Math.round(input.weight || 1)));
  const revenue = input.revenue ?? cpmFloor();
  if (!(revenue >= cpmFloor())) return { ok: false, reason: "revenue_below_floor" };
  if (input.starts_at && input.ends_at && input.ends_at < input.starts_at) return { ok: false, reason: "bad_date_range" };
  if (!input.placement_ids.length) return { ok: false, reason: "placement_required" };
  const known = db.prepare("SELECT id FROM placements").all() as { id: string }[];
  if (!input.placement_ids.every((p) => known.some((k) => k.id === p))) return { ok: false, reason: "unknown_placement" };

  const id = "cp_" + randomBytes(5).toString("hex");
  const t = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO campaigns (id, advertiser_id, name, status, weight, starts_at, ends_at, daily_impression_cap,
                              revenue, created_at, updated_at, created_by, updated_by)
       VALUES (?, 'house', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, weight, input.starts_at ?? null, input.ends_at ?? null, input.daily_impression_cap ?? null, revenue, t, t, actor, actor);
    for (const p of input.placement_ids)
      db.prepare("INSERT INTO campaign_placements (campaign_id, placement_id, created_at) VALUES (?, ?, ?)").run(id, p, t);
    db.prepare("INSERT INTO audit_log (ts, actor, action, object_type, object_id, detail) VALUES (?, ?, 'create', 'campaign', ?, ?)")
      .run(t, actor, id, JSON.stringify({ name, weight, revenue, placements: input.placement_ids }));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, value: id };
}

/** 狀態轉換：publish 需有可投放的素材（P1 起強制）；P0 先允許且 audit。 */
export function setStatus(id: string, to: "active" | "paused", actor: string): Result<string> {
  const db = getDb();
  const row = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  const allowed = to === "active" ? ["draft", "paused"] : ["active"];
  if (!allowed.includes(row.status)) return { ok: false, reason: `invalid_transition_${row.status}_to_${to}` };
  db.prepare("UPDATE campaigns SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(to, now(), actor, id);
  db.prepare("INSERT INTO audit_log (ts, actor, action, object_type, object_id, detail) VALUES (?, ?, ?, 'campaign', ?, ?)")
    .run(now(), actor, to === "active" ? "publish" : "pause", id, JSON.stringify({ from: row.status, to }));
  return { ok: true, value: to };
}
