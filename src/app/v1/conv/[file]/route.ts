import { getDb, now } from "@/lib/db.ts";
import { utcDay } from "@/lib/serve.ts";

export const dynamic = "force-dynamic";

// 1x1 透明 GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!file.endsWith(".gif")) return new Response("not found", { status: 404 });
  const db = getDb();
  const tk = db.prepare("SELECT id, campaign_id FROM trackers WHERE id = ?").get(file.slice(0, -4)) as { id: string; campaign_id: string } | undefined;
  if (!tk) return new Response("not found", { status: 404 });

  // 只記 tracker/campaign/day/時間戳，不記 IP、UA、referrer（SPEC §7.3）
  const day = utcDay(new Date());
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO conversions (ts, day, tracker_id, campaign_id, source) VALUES (?, ?, ?, ?, 'pixel')").run(now(), day, tk.id, tk.campaign_id);
    db.prepare(
      `INSERT INTO ad_counters (day, campaign_id, creative_id, placement_id, country, device, conversions) VALUES (?, ?, 'unknown', 'unknown', 'XX', 'unknown', 1)
       ON CONFLICT (day, campaign_id, creative_id, placement_id, country, device) DO UPDATE SET conversions = conversions + 1`,
    ).run(day, tk.campaign_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.warn("conversion_failed", e);
  }
  return new Response(new Uint8Array(PIXEL), { headers: { "content-type": "image/gif", "cache-control": "no-store" } });
}
