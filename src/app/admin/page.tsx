import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { cpmFloor, listCampaigns } from "@/lib/campaigns.ts";
import { creativeReady } from "@/lib/creatives.ts";
import { getDb } from "@/lib/db.ts";
import { readRange } from "@/lib/range.ts";
import { signAssetToken } from "@/lib/secret.ts";
import { runStats, type StatsRow } from "@/lib/stats.ts";
import CreateCampaign from "./CreateCampaign.tsx";
import DateRange from "./DateRange.tsx";
import ManagerTable, { type Col, type Row } from "./ManagerTable.tsx";
import Shell from "./Shell.tsx";
import { dash, errText, nf, pct, twd, when } from "./ui.ts";

export const dynamic = "force-dynamic";

type Level = "campaigns" | "creatives" | "placements";
type SP = { level?: string; q?: string; campaigns?: string; range?: string; from?: string; to?: string; error?: string };
type Creative = { id: string; campaign_id: string; kind: string; name: string; status: string; html: string | null; cta_url: string | null; logo_asset_id: string | null; thumb_asset_id: string | null };

const METRIC_COLS: Col[] = [
  { key: "impressions", label: "曝光次數", num: true }, { key: "clicks", label: "點擊次數", num: true }, { key: "ctr", label: "點閱率", num: true },
  { key: "conversions", label: "轉換", num: true }, { key: "value", label: "估計收益", num: true }, { key: "ecpm", label: "eCPM", num: true },
];
const LEVELS: { id: Level; label: string; icon: React.ReactNode }[] = [
  { id: "campaigns", label: "行銷活動", icon: <path d="M3 11l15-6v14L3 13zM7 13v5a2 2 0 0 0 4 0v-4" strokeLinejoin="round" /> },
  { id: "creatives", label: "素材", icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" strokeLinejoin="round" /></> },
  { id: "placements", label: "版位", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15h18" /></> },
];

/** 一列的成效欄位（沒資料顯示 —）。 */
function metricCells(m?: StatsRow): Record<string, string> {
  const n = (k: string) => Number(m?.[k as keyof StatsRow] ?? 0);
  return {
    impressions: dash(n("impressions")), clicks: dash(n("clicks")), ctr: n("impressions") ? pct(n("ctr")) : "—",
    conversions: dash(n("conversions")), value: n("value") ? twd(n("value")) : "—", ecpm: n("impressions") ? twd(n("ecpm")) : "—",
  };
}
function sumCells(ms: (StatsRow | undefined)[]): Record<string, string> {
  const s = { impressions: 0, clicks: 0, conversions: 0, value: 0 };
  for (const m of ms) if (m) for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] += Number(m[k]) || 0;
  return {
    impressions: nf(s.impressions), clicks: nf(s.clicks), ctr: s.impressions ? pct(s.clicks / s.impressions) : "—",
    conversions: dash(s.conversions), value: twd(s.value), ecpm: s.impressions ? twd((s.value / s.impressions) * 1000) : "—",
  };
}

export default async function ManagerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  const sp = await searchParams;
  const level: Level = sp.level === "creatives" || sp.level === "placements" ? sp.level : "campaigns";
  const range = readRange(sp);
  const q = (sp.q ?? "").trim().toLowerCase();
  const match = (...s: (string | null | undefined)[]) => !q || s.some((x) => x?.toLowerCase().includes(q));
  const onlyCampaigns = sp.campaigns ? new Set(sp.campaigns.split(",").filter(Boolean)) : null;
  const canEdit = user.role === "admin";
  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const stats = (by: "campaign" | "creative" | "placement", key: keyof StatsRow) =>
    new Map(runStats({ from: range.from, to: range.to, groupBy: [by] }).map((r) => [String(r[key]), r]));

  const campaigns = listCampaigns();
  const creatives = db.prepare("SELECT * FROM creatives ORDER BY created_at").all() as unknown as Creative[];
  const placementsOf = new Map<string, string[]>();
  for (const r of db.prepare("SELECT campaign_id, placement_id FROM campaign_placements").all() as { campaign_id: string; placement_id: string }[])
    placementsOf.set(r.campaign_id, [...(placementsOf.get(r.campaign_id) ?? []), r.placement_id]);
  /** 版位 → 這個活動在該版位缺不缺素材 */
  const missing = (campaignId: string) =>
    (placementsOf.get(campaignId) ?? []).filter((p) => !creatives.some((c) => c.campaign_id === campaignId && c.status === "active" && creativeReady(c, p)));

  let cols: Col[], rows: Row[], totals: Record<string, string>, totalLabel: string;

  if (level === "campaigns") {
    const m = stats("campaign", "campaign_id");
    const list = campaigns.filter((c) => match(c.name, c.id));
    cols = [
      { key: "placements", label: "版位" }, { key: "weight", label: "權重", num: true }, { key: "cpm", label: "CPM", num: true },
      { key: "schedule", label: "排期" }, ...METRIC_COLS,
    ];
    rows = list.map((c) => {
      const miss = missing(c.id);
      const ended = c.status === "ended" || (c.ends_at !== null && c.ends_at <= nowSec);
      let status: Row["status"];
      if (ended) status = { tone: "off", text: "已結束" };
      else if (c.status === "draft") status = { tone: "off", text: "草稿", hint: miss.length ? "尚缺素材" : "可以開啟" };
      else if (c.status === "paused") status = { tone: "off", text: "已關閉" };
      else if (c.starts_at !== null && c.starts_at > nowSec) status = { tone: "sched", text: "已排程", hint: `${when(c.starts_at)} 開始` };
      else if (miss.length) status = { tone: "warn", text: "素材未齊", hint: miss.join(", ") };
      else status = { tone: "ok", text: "投遞中" };
      return {
        id: c.id, name: c.name, href: `/admin/ads/${c.id}`, sub: c.id, status,
        toggle: { on: c.status === "active", disabled: ended },
        cells: {
          placements: (placementsOf.get(c.id) ?? []).join(", ") || "—", weight: String(c.weight), cpm: twd(c.revenue),
          schedule: c.starts_at || c.ends_at ? `${when(c.starts_at) ?? "立即"} – ${when(c.ends_at) ?? "不限"}` : "持續投放",
          ...metricCells(m.get(c.id)),
        },
      };
    });
    totals = sumCells(list.map((c) => m.get(c.id)));
    totalLabel = `${list.length} 個行銷活動的成果`;
  } else if (level === "creatives") {
    const m = stats("creative", "creative_id");
    const camp = new Map(campaigns.map((c) => [c.id, c]));
    const thumbs = new Map<string, string>();
    for (const a of db.prepare("SELECT id, creative_id FROM creative_assets WHERE variant = 'desktop' ORDER BY created_at").all() as { id: string; creative_id: string }[])
      thumbs.set(a.creative_id, `/v1/asset/${a.id}?t=${signAssetToken(a.id, 3600)}`);
    const list = creatives.filter((c) => (!onlyCampaigns || onlyCampaigns.has(c.campaign_id)) && match(c.name, c.id, camp.get(c.campaign_id)?.name));
    cols = [{ key: "campaign", label: "行銷活動" }, { key: "kind", label: "型態" }, { key: "link", label: "目標網址" }, ...METRIC_COLS];
    rows = list.map((c) => {
      const cp = camp.get(c.campaign_id);
      const miss = (placementsOf.get(c.campaign_id) ?? []).filter((p) => !creativeReady(c, p));
      let status: Row["status"];
      if (c.status !== "active") status = { tone: "off", text: "已關閉" };
      else if (miss.length) status = { tone: "warn", text: "素材未齊", hint: miss.join(", ") };
      else if (cp?.status !== "active") status = { tone: "off", text: "活動未開啟" };
      else status = { tone: "ok", text: "投遞中" };
      return {
        id: c.id, name: c.name, href: `/admin/ads/${c.campaign_id}#${c.id}`, sub: c.id, status, thumb: thumbs.get(c.id) ?? "",
        cells: {
          campaign: cp?.name ?? c.campaign_id, kind: { image: "圖片", native: "原生", html: "HTML" }[c.kind] ?? c.kind,
          link: c.cta_url?.replace(/^https:\/\//, "") ?? "—", ...metricCells(m.get(c.id)),
        },
      };
    });
    totals = sumCells(list.map((c) => m.get(c.id)));
    totalLabel = `${list.length} 個素材的成果`;
  } else {
    const m = stats("placement", "placement");
    const pls = db.prepare("SELECT * FROM placements ORDER BY id").all() as { id: string; site_id: string; status: string; width_desktop: number; height_desktop: number; width_mobile: number; height_mobile: number; description: string | null }[];
    const list = pls.filter((p) => match(p.id, p.description));
    cols = [{ key: "site", label: "網站" }, { key: "size", label: "尺寸（桌機／手機）" }, { key: "live", label: "投遞中活動", num: true }, ...METRIC_COLS];
    rows = list.map((p) => {
      const live = campaigns.filter((c) => c.status === "active" && (placementsOf.get(c.id) ?? []).includes(p.id) && !missing(c.id).includes(p.id)).length;
      return {
        id: p.id, name: p.description ?? p.id, sub: p.id,
        status: p.status !== "active" ? { tone: "off", text: "已停用" } : live ? { tone: "ok", text: "有廣告" } : { tone: "warn", text: "沒有可投放的廣告" },
        cells: { site: p.site_id, size: `${p.width_desktop}×${p.height_desktop}／${p.width_mobile}×${p.height_mobile}`, live: String(live), ...metricCells(m.get(p.id)) },
      };
    });
    totals = sumCells(list.map((p) => m.get(p.id)));
    totalLabel = `${list.length} 個版位的成果`;
  }

  const tabHref = (l: Level) => {
    const u = new URLSearchParams();
    if (l !== "campaigns") u.set("level", l);
    for (const k of ["range", "from", "to", "q"] as const) if (sp[k]) u.set(k, sp[k]!);
    if (l === "creatives" && sp.campaigns) u.set("campaigns", sp.campaigns);
    return `/admin${u.size ? `?${u}` : ""}`;
  };
  const placements = (db.prepare("SELECT id FROM placements WHERE status = 'active' ORDER BY id").all() as { id: string }[]).map((p) => p.id);

  return (
    <Shell user={user} section="manage" title="廣告管理">
      {sp.error && <div className="notice err">{errText(sp.error)}</div>}
      <div className="card">
        <form className="searchbar" method="get" action="/admin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" strokeLinecap="round" /></svg>
          {level !== "campaigns" && <input type="hidden" name="level" value={level} />}
          {(["range", "from", "to", "campaigns"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="以名稱或編號搜尋" aria-label="搜尋" />
          {sp.q && <a className="small" href={tabHref(level).replace(/([?&])q=[^&]*&?/, "$1").replace(/[?&]$/, "")}>清除</a>}
        </form>
      </div>
      <div>
        <div className="levels-wrap">
          <div className="levels">
            {LEVELS.map((l) => (
              <a key={l.id} href={tabHref(l.id)} className={level === l.id ? "on" : ""}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{l.icon}</svg>
                {l.label}
                {l.id === "creatives" && onlyCampaigns && <span className="badge" title="已依所選活動篩選">{onlyCampaigns.size} 個活動</span>}
              </a>
            ))}
          </div>
          <DateRange preset={range.preset} from={range.from} to={range.to} />
        </div>
        <div className="card manager">
          {level === "creatives" && onlyCampaigns && (
            <div className="notice info" style={{ margin: 12 }}>
              只顯示所選 {onlyCampaigns.size} 個行銷活動的素材。<a href={tabHref("creatives").replace(/([?&])campaigns=[^&]*&?/, "$1").replace(/[?&]$/, "")}>顯示全部</a>
            </div>
          )}
          <ManagerTable
            level={level} cols={cols} rows={rows} totals={totals} totalLabel={totalLabel} canEdit={canEdit}
            create={<CreateCampaign placements={placements} floor={cpmFloor()} disabled={!canEdit} />}
          />
        </div>
      </div>
    </Shell>
  );
}
