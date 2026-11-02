import { NextResponse } from "next/server";
import { getDb } from "@/lib/db.ts";
import pkg from "../../../../package.json" with { type: "json" };

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true, db: "ok", version: pkg.version, now: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: "error" }, { status: 503 });
  }
}
