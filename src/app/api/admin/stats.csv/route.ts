import { NextResponse } from "next/server";
import { BOM, csvHeader, csvLine } from "@/lib/csv.ts";
import { guard } from "@/lib/http.ts";
import { countStats, iterateStats, parseQuery } from "@/lib/stats.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = guard(req);
  if (g.res) return g.res;
  const p = parseQuery(new URL(req.url).searchParams);
  if (!p.ok) return NextResponse.json({ ok: false, reason: p.reason }, { status: 400 });
  const q = p.value;
  const rows = iterateStats(q);
  const enc = new TextEncoder();
  let sentHeader = false;
  // 串流輸出：每次吐一批，不整份組在記憶體
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      let buf = sentHeader ? "" : BOM + csvHeader();
      sentHeader = true;
      for (let i = 0; i < 500; i++) {
        const n = rows.next();
        if (n.done) { ctrl.enqueue(enc.encode(buf)); ctrl.close(); return; }
        buf += csvLine(n.value);
      }
      ctrl.enqueue(enc.encode(buf));
    },
  });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ads-report_${q.from}_${q.to}_${q.groupBy.join("-") || "total"}.csv"`,
      "x-row-count": String(countStats(q)),
      "cache-control": "no-store",
    },
  });
}
