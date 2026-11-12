import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { readRange } from "@/lib/range.ts";
import { DIM_NAMES, COLUMNS, parseQuery, runStats, totals } from "@/lib/stats.ts";
import DateRange from "../DateRange.tsx";
import Shell from "../Shell.tsx";
import { nf, pct, twd } from "../ui.ts";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  day: "日期", site: "網站", placement: "版位", campaign_id: "活動編號", campaign_name: "行銷活動", creative_id: "素材編號", creative_name: "素材",
  advertiser_name: "廣告主", country: "國家", device: "裝置", impressions: "曝光次數", clicks: "點擊次數", conversions: "轉換", ctr: "點閱率", cvr: "轉換率",
  value: "估計收益", ecpm: "eCPM", currency: "幣別",
};
const DIM_LABEL: Record<string, string> = { day: "日期", site: "網站", placement: "版位", campaign: "行銷活動", creative: "素材", country: "國家", device: "裝置" };
const ERR: Record<string, string> = { bad_date: "日期格式不正確", bad_date_range: "起日晚於迄日", bad_group_by: "分析項目不正確" };
const NUM = new Set(["impressions", "clicks", "conversions", "ctr", "cvr", "value", "ecpm"]);
const MAX_ROWS = 500;

const show = (c: string, v: string | number) =>
  c === "ctr" || c === "cvr" ? pct(Number(v)) : c === "value" || c === "ecpm" ? twd(Number(v)) : NUM.has(c) ? nf(Number(v)) : String(v);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const range = readRange({ range: one("range"), from: one("from"), to: one("to") });

  const qs = new URLSearchParams();
  qs.set("from", range.from);
  qs.set("to", range.to);
  const gb = sp.groupBy === undefined ? "day,campaign,placement" : [sp.groupBy].flat().join(",");
  qs.set("groupBy", gb);
  for (const k of ["site", "campaign_id", "placement_id", "country", "device"]) if (one(k)) qs.set(k, one(k));

  const p = parseQuery(qs);
  const rows = p.ok ? runStats(p.value, MAX_ROWS + 1) : [];
  const total = p.ok ? totals(p.value) : null;
  const shown = rows.slice(0, MAX_ROWS);
  const dimCols = COLUMNS.filter((c) => !NUM.has(c) && c !== "currency" && shown.some((r) => r[c] !== ""));
  const cols = [...dimCols, ...COLUMNS.filter((c) => NUM.has(c))];
  const chosen = new Set(gb.split(","));

  return (
    <Shell user={user} section="reports" title="報表" actions={p.ok ? <a className="btn sm" href={`/api/admin/stats.csv?${qs}`}>匯出 CSV</a> : undefined}>
      <div className="card">
        <div className="toolbar" style={{ gap: 12 }}>
          <DateRange preset={range.preset} from={range.from} to={range.to} />
          <span className="sp" />
          <span className="muted small">日界為 UTC（台北早 8 小時）</span>
        </div>
      <form method="get" action="/admin/reports">
        {one("range") && <input type="hidden" name="range" value={one("range")} />}
        {!one("range") && one("from") && <><input type="hidden" name="from" value={one("from")} /><input type="hidden" name="to" value={one("to")} /></>}
        <div className="toolbar">
          <span className="small" style={{ fontWeight: 600 }}>分析項目</span>
          {DIM_NAMES.map((d) => (
            <label key={d} className="chip">
              <input type="checkbox" name="groupBy" value={d} defaultChecked={chosen.has(d)} /> {DIM_LABEL[d]}
            </label>
          ))}
        </div>
        <div className="card-b">
          <div className="fields" style={{ alignItems: "end" }}>
            <label className="field">網站<select name="site" defaultValue={one("site")}><option value="">全部</option><option>javis</option><option>javid</option></select></label>
            <label className="field">活動編號<input name="campaign_id" defaultValue={one("campaign_id")} placeholder="cp_…" /></label>
            <label className="field">版位<input name="placement_id" defaultValue={one("placement_id")} placeholder="javis:watch-below" /></label>
            <label className="field">國家<input name="country" defaultValue={one("country")} maxLength={2} placeholder="TW" /></label>
            <label className="field">裝置<select name="device" defaultValue={one("device")}><option value="">全部</option><option value="desktop">桌機</option><option value="mobile">手機</option><option value="tablet">平板</option><option value="unknown">不明</option></select></label>
            <div><button className="primary">套用</button></div>
          </div>
        </div>
      </form>
      </div>

      {!p.ok && <div className="notice err">{ERR[p.reason] ?? p.reason}</div>}
      {p.ok && (
        <div className="card">
          {rows.length > MAX_ROWS && <div className="notice err" style={{ margin: 12 }}>超過 {MAX_ROWS} 列，畫面只顯示前 {MAX_ROWS} 列；完整資料請匯出 CSV。</div>}
          <div className="tbl-wrap">
            <table className="grid">
              <thead><tr>{cols.map((c) => <th key={c} className={NUM.has(c) ? "num" : ""}>{LABEL[c]}</th>)}</tr></thead>
              <tbody>
                {shown.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={NUM.has(c) ? "num" : ""}>{show(c, r[c])}</td>)}</tr>)}
                {!shown.length && <tr><td className="empty" colSpan={cols.length}>這段期間沒有資料</td></tr>}
              </tbody>
              {total && shown.length > 0 && (
                <tfoot><tr>{cols.map((c, i) => <td key={c} className={NUM.has(c) ? "num" : ""}>{i === 0 ? "合計" : NUM.has(c) ? show(c, total[c]) : ""}</td>)}</tr></tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
