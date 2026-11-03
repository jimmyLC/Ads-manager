import { NextResponse } from "next/server";
import { createCampaign, listCampaigns } from "@/lib/campaigns.ts";
import { guard, readBody, respond } from "@/lib/http.ts";

export async function GET(req: Request) {
  const g = guard(req);
  if (g.res) return g.res;
  return NextResponse.json({ ok: true, ads: listCampaigns() });
}

// 表單的 datetime-local 無時區，一律視為台北時間（settings.targeting_timezone 預設值）
const epoch = (s?: string) => (s ? Math.floor(new Date(s.length === 16 ? `${s}:00+08:00` : s).getTime() / 1000) || undefined : undefined);
const int = (s?: string) => (s ? Math.max(0, Math.round(Number(s))) || undefined : undefined);

export async function POST(req: Request) {
  const g = guard(req, "admin");
  if (g.res) return g.res;
  const b = await readBody(req);
  const r = createCampaign(
    {
      name: b.name ?? "",
      placement_ids: (b.placement_ids ?? b.placement_id ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      weight: Number(b.weight || 1),
      revenue: b.revenue ? Number(b.revenue) : undefined,
      starts_at: epoch(b.starts_at),
      ends_at: epoch(b.ends_at),
      daily_impression_cap: int(b.daily_impression_cap),
    },
    g.user.username,
  );
  return respond(req, r.ok ? "/admin" : `/admin?error=${r.reason}`, r.ok ? { ok: true, id: r.value } : { ok: false, reason: r.reason }, r.ok ? 201 : 400);
}
