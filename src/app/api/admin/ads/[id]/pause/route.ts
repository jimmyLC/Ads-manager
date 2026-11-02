import { NextResponse } from "next/server";
import { setStatus } from "@/lib/campaigns.ts";
import { guard, respond } from "@/lib/http.ts";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = guard(req, "admin");
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const r = setStatus(id, "paused", g.user.username);
  if (!r.ok && r.reason === "not_found") return NextResponse.json({ ok: false, reason: r.reason }, { status: 404 });
  return respond(req, r.ok ? "/admin" : `/admin?error=${r.reason}`, r.ok ? { ok: true, status: r.value } : { ok: false, reason: r.reason }, r.ok ? 200 : 409);
}
