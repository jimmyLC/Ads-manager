import { createCreative } from "@/lib/creatives.ts";
import { guard, readBody, respond } from "@/lib/http.ts";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = guard(req, "admin");
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const b = await readBody(req);
  const r = createCreative(
    { campaign_id: id, kind: b.kind ?? "image", name: b.name ?? "", alt_text: b.alt_text, cta_url: b.cta_url, headline: b.headline, body: b.body, cta_label: b.cta_label, html: b.html },
    g.user.username, g.user.role,
  );
  return respond(req, `/admin/ads/${id}${r.ok ? "" : `?error=${r.reason}`}`, r.ok ? { ok: true, id: r.value } : { ok: false, reason: r.reason }, r.ok ? 201 : 400);
}
