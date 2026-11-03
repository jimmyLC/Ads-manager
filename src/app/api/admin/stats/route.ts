import { NextResponse } from "next/server";
import { guard } from "@/lib/http.ts";
import { parseQuery, runStats, totals } from "@/lib/stats.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = guard(req);
  if (g.res) return g.res;
  const p = parseQuery(new URL(req.url).searchParams);
  if (!p.ok) return NextResponse.json({ ok: false, reason: p.reason }, { status: 400 });
  return NextResponse.json({ ok: true, query: p.value, rows: runStats(p.value), totals: totals(p.value) });
}
