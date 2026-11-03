import { NextResponse } from "next/server";
import { storeAsset } from "@/lib/assets.ts";
import { getDb } from "@/lib/db.ts";
import { guard, respond } from "@/lib/http.ts";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = guard(req, "admin");
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  // 參數可放 query 或表單欄位
  const field = (k: string) => url.searchParams.get(k) ?? String(fd?.get(k) ?? "");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, reason: "file_required" }, { status: 400 });

  const owner = getDb().prepare("SELECT campaign_id FROM creatives WHERE id = ?").get(field("creative_id")) as { campaign_id: string } | undefined;
  const r = !owner ? { ok: false as const, reason: "creative_not_found" }
    : owner.campaign_id !== id ? { ok: false as const, reason: "creative_not_in_campaign" }
    : storeAsset(field("creative_id"), field("placement_id"), field("variant"), Buffer.from(await file.arrayBuffer()), g.user.username);
  return respond(req, `/admin/ads/${id}${r.ok ? "" : `?error=${r.reason}`}`, r.ok ? { ok: true, id: r.value } : { ok: false, reason: r.reason }, r.ok ? 201 : 400);
}
