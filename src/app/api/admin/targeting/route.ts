import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit.ts";
import { getDb, now } from "@/lib/db.ts";
import { guard, readBody, respond } from "@/lib/http.ts";

const DIMS = ["country", "placement", "device", "hour", "weekday", "path"];
const OPS = ["in", "not_in", "equals"];

export async function GET(req: Request) {
  const g = guard(req);
  if (g.res) return g.res;
  const c = new URL(req.url).searchParams.get("campaign_id");
  const rows = c
    ? getDb().prepare("SELECT * FROM targeting_rules WHERE campaign_id = ? ORDER BY created_at").all(c)
    : getDb().prepare("SELECT * FROM targeting_rules ORDER BY campaign_id, created_at").all();
  return NextResponse.json({ ok: true, rules: rows });
}

export async function POST(req: Request) {
  const g = guard(req, "admin");
  if (g.res) return g.res;
  const b = await readBody(req);
  if (b.action === "delete") return removeRule(req, g.user.username, b.id);
  const fail = (reason: string) => respond(req, `/admin/ads/${b.campaign_id}?error=${reason}`, { ok: false, reason }, 400);
  if (!getDb().prepare("SELECT 1 FROM campaigns WHERE id = ?").get(b.campaign_id)) return fail("campaign_not_found");
  if (!DIMS.includes(b.dimension)) return fail("bad_dimension");
  if (!OPS.includes(b.operator)) return fail("bad_operator");
  const value = (b.value ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(",");
  if (!value) return fail("value_required");
  const vals = value.split(",");
  if (b.dimension === "hour" && !vals.every((v) => /^\d+$/.test(v) && +v <= 23)) return fail("bad_hour");
  if (b.dimension === "weekday" && !vals.every((v) => /^[1-7]$/.test(v))) return fail("bad_weekday");
  if (b.dimension === "country" && !vals.every((v) => /^[A-Za-z]{2}$/.test(v))) return fail("bad_country");
  if (b.operator === "equals" && vals.length !== 1) return fail("equals_needs_single_value");

  const id = "tg_" + randomBytes(5).toString("hex");
  const t = now();
  getDb().prepare("INSERT INTO targeting_rules (id, campaign_id, dimension, operator, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, b.campaign_id, b.dimension, b.operator, b.dimension === "country" ? value.toUpperCase() : value, t, t);
  audit(g.user.username, "create", "targeting_rule", id, { campaign: b.campaign_id, dimension: b.dimension, operator: b.operator, value });
  return respond(req, `/admin/ads/${b.campaign_id}`, { ok: true, id }, 201);
}

export async function DELETE(req: Request) {
  const g = guard(req, "admin");
  if (g.res) return g.res;
  return removeRule(req, g.user.username, new URL(req.url).searchParams.get("id") ?? (await readBody(req)).id);
}

function removeRule(req: Request, actor: string, id: string) {
  const row = getDb().prepare("SELECT campaign_id FROM targeting_rules WHERE id = ?").get(id) as { campaign_id: string } | undefined;
  if (!row) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  getDb().prepare("DELETE FROM targeting_rules WHERE id = ?").run(id);
  audit(actor, "delete", "targeting_rule", id, { campaign: row.campaign_id });
  return respond(req, `/admin/ads/${row.campaign_id}`, { ok: true });
}
