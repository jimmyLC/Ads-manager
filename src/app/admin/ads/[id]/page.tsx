import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { creativeReady } from "@/lib/creatives.ts";
import { IMAGE_VARIANTS, NATIVE_VARIANTS } from "@/lib/assets.ts";
import { readRange } from "@/lib/range.ts";
import { signAssetToken } from "@/lib/secret.ts";
import { totals } from "@/lib/stats.ts";
import CampaignSwitch from "../../CampaignSwitch.tsx";
import DateRange from "../../DateRange.tsx";
import Shell from "../../Shell.tsx";
import { errText, nf, pct, twd, when } from "../../ui.ts";

export const dynamic = "force-dynamic";

type Campaign = { id: string; name: string; status: string; weight: number; revenue: number; revenue_type: string; currency: string; starts_at: number | null; ends_at: number | null; daily_impression_cap: number | null; created_at: number; created_by: string | null };
type Creative = { id: string; kind: string; name: string; status: string; alt_text: string | null; html: string | null; cta_url: string | null; logo_asset_id: string | null; thumb_asset_id: string | null };
type Asset = { id: string; creative_id: string; placement_id: string; variant: string; width: number; height: number; bytes: number };

const STATUS: Record<string, string> = { draft: "草稿", active: "開啟中", paused: "已關閉", ended: "已結束" };
const KIND: Record<string, string> = { image: "圖片", native: "原生", html: "HTML" };
const DIM: Record<string, string> = { country: "國別", device: "裝置", hour: "時段（台北）", weekday: "星期（台北）", placement: "版位" };
const OP: Record<string, string> = { in: "包含", not_in: "排除", equals: "等於" };

export default async function CampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; range?: string; from?: string; to?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const camp = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Campaign | undefined;
  if (!camp) notFound();
  const placements = (db.prepare("SELECT placement_id FROM campaign_placements WHERE campaign_id = ?").all(id) as { placement_id: string }[]).map((p) => p.placement_id);
  const creatives = db.prepare("SELECT * FROM creatives WHERE campaign_id = ? ORDER BY created_at").all(id) as unknown as Creative[];
  const assets = db.prepare("SELECT id, creative_id, placement_id, variant, width, height, bytes FROM creative_assets WHERE creative_id IN (SELECT id FROM creatives WHERE campaign_id = ?) ORDER BY variant").all(id) as Asset[];
  const rules = db.prepare("SELECT * FROM targeting_rules WHERE campaign_id = ?").all(id) as { id: string; dimension: string; operator: string; value: string }[];
  const range = readRange(sp);
  const t = totals({ from: range.from, to: range.to, groupBy: [], campaign_id: id });
  const life = totals({ from: "2000-01-01", to: "2999-12-31", groupBy: [], campaign_id: id });
  const isAdmin = user.role === "admin";
  const ended = camp.status === "ended" || (camp.ends_at !== null && camp.ends_at <= Math.floor(Date.now() / 1000));
  const preview = (c: Creative) => {
    const a = assets.find((x) => x.creative_id === c.id && x.variant === "desktop");
    return a ? `/v1/asset/${a.id}?t=${signAssetToken(a.id, 3600)}` : null;
  };

  return (
    <Shell user={user} section="manage" title="廣告管理">
      <div className="crumbs"><a href="/admin">行銷活動</a><span>›</span><span>{camp.name}</span></div>
      {sp.error && <div className="notice err">操作失敗：{errText(sp.error)}</div>}

      <div className="card">
        <div className="card-h" style={{ flexWrap: "wrap", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h1>{camp.name}</h1>
            <div className="small muted">{camp.id}・{STATUS[ended ? "ended" : camp.status] ?? camp.status}・版位 {placements.join(", ") || "—"}</div>
          </div>
          <span style={{ flex: 1 }} />
          <CampaignSwitch id={camp.id} on={camp.status === "active"} disabled={!isAdmin || ended} />
        </div>
      </div>

      <div className="detail">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="card">
            <div className="card-h"><h2>素材</h2><span className="muted small">{creatives.length} 個</span></div>
            {creatives.map((c) => {
              const img = preview(c);
              return (
                <div className="creative" id={c.id} key={c.id}>
                  {img ? <img className="preview" src={img} alt={c.alt_text ?? ""} /> : <div className="preview">{c.kind === "html" ? "HTML 素材" : "尚未上傳"}</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                    <div><strong>{c.name}</strong> <span className="tag">{KIND[c.kind] ?? c.kind}</span> <code>{c.id}</code></div>
                    <div className="tags">
                      {placements.map((p) => {
                        const ok = creativeReady(c, p);
                        return <span key={p} className={`tag ${ok ? "ok" : "warn"}`}>{ok ? "✓" : "!"} {p}：{ok ? "齊備" : "缺桌機或手機圖"}</span>;
                      })}
                    </div>
                    <dl className="props">
                      <dt>目標網址</dt><dd>{c.cta_url ? <a href={c.cta_url} target="_blank" rel="noopener noreferrer">{c.cta_url}</a> : "—"}</dd>
                      {c.alt_text && <><dt>替代文字</dt><dd>{c.alt_text}</dd></>}
                      <dt>檔案</dt>
                      <dd>
                        {assets.filter((a) => a.creative_id === c.id).map((a) => (
                          <div key={a.id} className="small">{a.placement_id}・{a.variant}・{a.width}×{a.height}・{Math.round(a.bytes / 1024)} KB</div>
                        ))}
                        {!assets.some((a) => a.creative_id === c.id) && <span className="muted">—</span>}
                      </dd>
                    </dl>
                    {isAdmin && (c.kind === "image" || c.kind === "native") && (
                      <details className="more">
                        <summary>上傳／替換圖片</summary>
                        <form method="post" action={`/api/admin/ads/${id}/assets`} encType="multipart/form-data" className="fields" style={{ alignItems: "end" }}>
                          <input type="hidden" name="creative_id" value={c.id} />
                          <label className="field">版位<select name="placement_id">{placements.map((p) => <option key={p}>{p}</option>)}</select></label>
                          <label className="field">變體<select name="variant">{(c.kind === "image" ? IMAGE_VARIANTS : NATIVE_VARIANTS).map((v) => <option key={v}>{v}</option>)}</select>
                            <span className="hint">桌機 1280×400、手機 640×200（@2x 為兩倍）</span></label>
                          <label className="field">檔案<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required /></label>
                          <div><button className="primary">上傳</button></div>
                        </form>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
            {!creatives.length && <div className="card-b muted">還沒有素材。</div>}
            {isAdmin && (
              <div className="card-b" style={{ borderTop: "1px solid var(--line-2)" }}>
                <details className="more">
                  <summary>＋ 新增素材</summary>
                  <form method="post" action={`/api/admin/ads/${id}/creatives`} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div className="fields">
                      <label className="field">型態<select name="kind"><option value="image">圖片</option><option value="native">原生</option><option value="html">HTML</option></select></label>
                      <label className="field">名稱<input name="name" required /></label>
                      <label className="field">目標網址<input name="cta_url" type="url" required placeholder="https://" /></label>
                      <label className="field">替代文字<input name="alt_text" /><span className="hint">圖片、原生必填</span></label>
                    </div>
                    <div className="fields">
                      <label className="field">標題（原生）<input name="headline" maxLength={60} /></label>
                      <label className="field">描述（原生）<input name="body" maxLength={140} /></label>
                      <label className="field">按鈕文字（原生）<input name="cta_label" maxLength={20} /></label>
                    </div>
                    <label className="field">HTML（HTML 型態）<textarea name="html" rows={3} /></label>
                    <div><button className="primary">建立素材</button></div>
                  </form>
                </details>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-h"><h2>受眾與時段</h2></div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rules.length ? (
                <div className="tags">
                  {rules.map((r) => (
                    <span key={r.id} className="tag">
                      {DIM[r.dimension] ?? r.dimension} {OP[r.operator] ?? r.operator} <code>{r.value}</code>
                      {isAdmin && (
                        <form method="post" action="/api/admin/targeting" className="inline">
                          <input type="hidden" name="action" value="delete" /><input type="hidden" name="id" value={r.id} />
                          <button className="ghost sm" style={{ height: 20, padding: "0 4px" }} aria-label="刪除條件">✕</button>
                        </form>
                      )}
                    </span>
                  ))}
                </div>
              ) : <span className="muted">沒有限制：所有國家、裝置、時段都會投放。</span>}
              {isAdmin && (
                <details className="more">
                  <summary>＋ 新增條件</summary>
                  <form method="post" action="/api/admin/targeting" className="fields" style={{ alignItems: "end" }}>
                    <input type="hidden" name="campaign_id" value={id} />
                    <label className="field">維度<select name="dimension">{Object.entries(DIM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label className="field">條件<select name="operator">{Object.entries(OP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label className="field">值<input name="value" required placeholder="TW,JP 或 9-23" /><span className="hint">多個值用逗號分隔</span></label>
                    <div><button className="primary">新增</button></div>
                  </form>
                </details>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div className="card-h" style={{ flexWrap: "wrap" }}><h2>成效</h2></div>
            <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--line-2)" }}><DateRange preset={range.preset} from={range.from} to={range.to} /></div>
            <div className="kpis">
              <div className="kpi"><div className="v">{nf(Number(t.impressions))}</div><div className="l">曝光次數</div></div>
              <div className="kpi"><div className="v">{nf(Number(t.clicks))}</div><div className="l">點擊次數</div></div>
              <div className="kpi"><div className="v">{Number(t.impressions) ? pct(Number(t.ctr)) : "—"}</div><div className="l">點閱率</div></div>
              <div className="kpi"><div className="v">{nf(Number(t.conversions))}</div><div className="l">轉換</div></div>
              <div className="kpi"><div className="v">{twd(Number(t.value))}</div><div className="l">估計收益</div></div>
              <div className="kpi"><div className="v">{Number(t.impressions) ? twd(Number(t.ecpm)) : "—"}</div><div className="l">eCPM</div></div>
            </div>
            <div className="card-b small muted">累計：曝光 {nf(Number(life.impressions))}・點擊 {nf(Number(life.clicks))}・<a href={`/admin/reports?campaign_id=${id}&groupBy=day,creative`}>看報表</a></div>
          </div>
          <div className="card">
            <div className="card-h"><h2>設定</h2></div>
            <div className="card-b">
              <dl className="props">
                <dt>權重</dt><dd>{camp.weight}</dd>
                <dt>計價</dt><dd>{camp.revenue_type.toUpperCase()} {twd(camp.revenue)}</dd>
                <dt>開始</dt><dd>{when(camp.starts_at) ?? "立即"}</dd>
                <dt>結束</dt><dd>{when(camp.ends_at) ?? "不限"}</dd>
                <dt>每日上限</dt><dd>{camp.daily_impression_cap ? `${nf(camp.daily_impression_cap)} 次曝光` : "不限"}</dd>
                <dt>建立</dt><dd>{when(camp.created_at) ?? "—"}{camp.created_by ? `・${camp.created_by}` : ""}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
