import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { DIM_NAMES, COLUMNS, parseQuery, runStats, totals } from "@/lib/stats.ts";
import Nav from "../Nav.tsx";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  day: "日期", site: "站", placement: "版位", campaign_id: "活動 ID", campaign_name: "活動", creative_id: "素材 ID", creative_name: "素材",
  advertiser_name: "廣告主", country: "國別", device: "裝置", impressions: "曝光", clicks: "點擊", conversions: "轉換", ctr: "CTR", cvr: "CVR",
  value: "價值", ecpm: "eCPM", currency: "幣別",
};
const DIM_LABEL: Record<string, string> = { day: "日期", site: "站", placement: "版位", campaign: "活動", creative: "素材", country: "國別", device: "裝置" };
const ERR: Record<string, string> = { bad_date: "日期格式不正確", bad_date_range: "起日晚於迄日", bad_group_by: "分組維度不正確" };
const MAX_ROWS = 500;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400_000));

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";

  const qs = new URLSearchParams();
  qs.set("from", one("from") || daysAgo(6));
  qs.set("to", one("to") || daysAgo(0));
  const gb = sp.groupBy === undefined ? "day,campaign,placement" : [sp.groupBy].flat().join(",");
  qs.set("groupBy", gb);
  for (const k of ["site", "campaign_id", "placement_id", "country", "device"]) if (one(k)) qs.set(k, one(k));

  const p = parseQuery(qs);
  const rows = p.ok ? runStats(p.value, MAX_ROWS + 1) : [];
  const total = p.ok ? totals(p.value) : null;
  const shown = rows.slice(0, MAX_ROWS);
  const cols = COLUMNS.filter((c) => c === "impressions" || shown.some((r) => r[c] !== "") || ["clicks", "conversions", "ctr", "cvr", "value", "ecpm", "currency"].includes(c));
  const chosen = new Set(gb.split(","));
  const range = (n: number) => `/admin/reports?from=${daysAgo(n - 1)}&to=${daysAgo(0)}&groupBy=${gb}`;

  return (
    <main>
      <Nav user={user} />
      <h2>報表</h2>
      <p>
        快速：<a href={range(7)}>近 7 天</a>　<a href={range(30)}>近 30 天</a>　
        <small>（日界為 UTC；與台北差 8 小時）</small>
      </p>
      <form method="get" action="/admin/reports">
        <div className="grid">
          <label>起日<input type="date" name="from" defaultValue={qs.get("from")!} /></label>
          <label>迄日<input type="date" name="to" defaultValue={qs.get("to")!} /></label>
          <label>站<select name="site" defaultValue={one("site")}><option value="">全部（跨站合計）</option><option>javis</option><option>javid</option></select></label>
          <label>活動 ID<input name="campaign_id" defaultValue={one("campaign_id")} /></label>
          <label>版位<input name="placement_id" defaultValue={one("placement_id")} placeholder="javis:watch-below" /></label>
          <label>國別<input name="country" defaultValue={one("country")} maxLength={2} /></label>
          <label>裝置<select name="device" defaultValue={one("device")}><option value="">全部</option><option>desktop</option><option>mobile</option><option>tablet</option><option>unknown</option></select></label>
        </div>
        <p>
          分組：{DIM_NAMES.map((d) => (
            <label key={d} style={{ display: "inline-flex", flexDirection: "row", gap: 4, marginRight: 12 }}>
              <input type="checkbox" name="groupBy" value={d} defaultChecked={chosen.has(d)} /> {DIM_LABEL[d]}
            </label>
          ))}
        </p>
        <button className="primary">查詢</button>{" "}
        {p.ok && <a href={`/api/admin/stats.csv?${qs}`}>匯出 CSV</a>}
      </form>

      {!p.ok && <p className="err">{ERR[p.reason] ?? p.reason}</p>}
      {p.ok && (
        <>
          {rows.length > MAX_ROWS && <p className="err">超過 {MAX_ROWS} 列，畫面只顯示前 {MAX_ROWS} 列；完整資料請匯出 CSV。</p>}
          <div className="scroll">
            <table>
              <thead><tr>{cols.map((c) => <th key={c}>{LABEL[c]}</th>)}</tr></thead>
              <tbody>
                {shown.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c])}</td>)}</tr>)}
                {!shown.length && <tr><td colSpan={cols.length}>此範圍沒有資料</td></tr>}
              </tbody>
              {total && shown.length > 0 && (
                <tfoot><tr>{cols.map((c, i) => <th key={c}>{i === 0 ? "合計" : ["impressions", "clicks", "conversions", "ctr", "cvr", "value", "ecpm"].includes(c) ? String(total[c]) : ""}</th>)}</tr></tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </main>
  );
}
