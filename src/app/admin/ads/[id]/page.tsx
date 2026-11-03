import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { creativeReady } from "@/lib/creatives.ts";
import { IMAGE_VARIANTS, NATIVE_VARIANTS } from "@/lib/assets.ts";
import Nav from "../../Nav.tsx";

export const dynamic = "force-dynamic";

type Creative = { id: string; kind: string; name: string; status: string; html: string | null; cta_url: string | null; logo_asset_id: string | null; thumb_asset_id: string | null };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  const { id } = await params;
  const { error } = await searchParams;
  const db = getDb();
  const camp = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as { id: string; name: string; status: string } | undefined;
  if (!camp) notFound();
  const placements = db.prepare("SELECT placement_id FROM campaign_placements WHERE campaign_id = ?").all(id) as { placement_id: string }[];
  const creatives = db.prepare("SELECT * FROM creatives WHERE campaign_id = ? ORDER BY created_at").all(id) as unknown as Creative[];
  const assets = db.prepare("SELECT creative_id, placement_id, variant, width, height, bytes FROM creative_assets WHERE creative_id IN (SELECT id FROM creatives WHERE campaign_id = ?)").all(id) as { creative_id: string; placement_id: string; variant: string; width: number; height: number; bytes: number }[];
  const rules = db.prepare("SELECT * FROM targeting_rules WHERE campaign_id = ?").all(id) as { id: string; dimension: string; operator: string; value: string }[];
  const counts = db.prepare("SELECT COALESCE(SUM(impressions),0) i, COALESCE(SUM(clicks),0) k, COALESCE(SUM(conversions),0) c FROM ad_counters WHERE campaign_id = ?").get(id) as { i: number; k: number; c: number };
  const isAdmin = user.role === "admin";

  return (
    <main>
      <Nav user={user} />
      <p><a href="/admin">← 活動列表</a></p>
      <h2>{camp.name} <span className="pill">{camp.status}</span></h2>
      <p>累計：曝光 {counts.i}／點擊 {counts.k}／轉換 {counts.c}｜版位：{placements.map((p) => p.placement_id).join(", ")}</p>
      {error && <p className="err">操作失敗：{error}</p>}

      <h3>素材</h3>
      {creatives.map((c) => (
        <div key={c.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
          <strong>{c.name}</strong> <code>{c.id}</code> <span className="pill">{c.kind}</span>{" "}
          {placements.map((p) => (
            <span key={p.placement_id} className={`pill ${creativeReady(c, p.placement_id) ? "active" : "paused"}`}>
              {p.placement_id}：{creativeReady(c, p.placement_id) ? "齊備" : "素材未齊"}
            </span>
          ))}
          <br /><small>→ {c.cta_url}</small>
          <ul>{assets.filter((a) => a.creative_id === c.id).map((a) => <li key={a.placement_id + a.variant}>{a.placement_id} / {a.variant}：{a.width}×{a.height}（{Math.round(a.bytes / 1024)}KB）</li>)}</ul>
          {isAdmin && (c.kind === "image" || c.kind === "native") && (
            <form method="post" action={`/api/admin/ads/${id}/assets`} encType="multipart/form-data" className="grid">
              <input type="hidden" name="creative_id" value={c.id} />
              <label>版位<select name="placement_id">{placements.map((p) => <option key={p.placement_id}>{p.placement_id}</option>)}</select></label>
              <label>變體<select name="variant">{(c.kind === "image" ? IMAGE_VARIANTS : NATIVE_VARIANTS).map((v) => <option key={v}>{v}</option>)}</select></label>
              <label>檔案<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required /></label>
              <button>上傳</button>
            </form>
          )}
        </div>
      ))}
      {!creatives.length && <p>尚無素材。</p>}

      {isAdmin && (
        <form method="post" action={`/api/admin/ads/${id}/creatives`}>
          <h4>新增素材</h4>
          <div className="grid">
            <label>型態<select name="kind"><option>image</option><option>native</option><option>html</option></select></label>
            <label>名稱<input name="name" required /></label>
            <label>目標網址（https）<input name="cta_url" type="url" required /></label>
            <label>替代文字 alt<input name="alt_text" /></label>
            <label>標題（native）<input name="headline" maxLength={60} /></label>
            <label>描述（native）<input name="body" maxLength={140} /></label>
            <label>按鈕文字（native）<input name="cta_label" maxLength={20} /></label>
            <label>HTML（html）<input name="html" /></label>
          </div>
          <button className="primary">建立素材</button>
        </form>
      )}

      <h3>定向條件</h3>
      <ul>{rules.map((r) => (
        <li key={r.id}>{r.dimension} {r.operator} <code>{r.value}</code>{" "}
          {isAdmin && (
            <form method="post" action="/api/admin/targeting" className="inline">
              <input type="hidden" name="action" value="delete" /><input type="hidden" name="id" value={r.id} /><button>刪除</button>
            </form>
          )}
        </li>
      ))}</ul>
      {!rules.length && <p>無（全部國別、時段皆可）。</p>}
      {isAdmin && (
        <form method="post" action="/api/admin/targeting" className="grid">
          <input type="hidden" name="campaign_id" value={id} />
          <label>維度<select name="dimension"><option>country</option><option>device</option><option>hour</option><option>weekday</option><option>placement</option></select></label>
          <label>運算<select name="operator"><option>in</option><option>not_in</option><option>equals</option></select></label>
          <label>值（逗號分隔）<input name="value" required /></label>
          <button>新增條件</button>
        </form>
      )}
    </main>
  );
}
