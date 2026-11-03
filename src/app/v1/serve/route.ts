import { NextResponse } from "next/server";
import { serve } from "@/lib/serve.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const site = q.get("site"), slot = q.get("slot");
  if (!site || !slot) return NextResponse.json({ ok: false, reason: "unknown_placement" }, { status: 404 });
  try {
    const r = serve({ site, slot, country: q.get("country"), device: q.get("device") });
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("serve_failed", e);
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 500 });
  }
}
