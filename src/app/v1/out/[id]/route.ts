import { NextResponse } from "next/server";
import { getDb } from "@/lib/db.ts";
import { normCountry, normDevice, utcDay } from "@/lib/serve.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const db = getDb();
  const cr = db.prepare("SELECT id, campaign_id, cta_url FROM creatives WHERE id = ?").get(id) as
    | { id: string; campaign_id: string; cta_url: string | null } | undefined;
  if (!cr?.cta_url) return new Response("not found", { status: 404 });

  // 目標網址只取自資料庫，不接受 request 帶入（無 open redirect）
  const placement = q.get("placement") ?? "";
  const known = db.prepare("SELECT 1 FROM placements WHERE id = ?").get(placement) ? placement : "unknown";
  try {
    db.prepare(
      `INSERT INTO ad_counters (day, campaign_id, creative_id, placement_id, country, device, clicks) VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (day, campaign_id, creative_id, placement_id, country, device) DO UPDATE SET clicks = clicks + 1`,
    ).run(utcDay(new Date()), cr.campaign_id, cr.id, known, normCountry(q.get("country")), normDevice(q.get("device") ?? q.get("d")));
  } catch (e) {
    console.warn("click_count_failed", e);
  }
  return NextResponse.redirect(cr.cta_url, { status: 302, headers: { "cache-control": "no-store" } });
}
