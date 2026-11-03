import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { cpmFloor, listCampaigns } from "@/lib/campaigns.ts";
import { getDb } from "@/lib/db.ts";
import Nav from "./Nav.tsx";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  name_required: "請填名稱", revenue_below_floor: "CPM 單價低於最低值", bad_date_range: "結束時間早於開始時間",
  no_ready_creative: "每個版位都要至少一個齊備的素材才能上線", placement_required: "請選擇版位", unknown_placement: "版位不存在", not_found: "找不到活動",
};
const STATUS: Record<string, string> = { draft: "草稿", active: "投放中", paused: "已下架", ended: "已結束" };
const fmt = (t: number | null) => (t ? new Date(t * 1000).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "不限");

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  const { error } = await searchParams;
  const rows = listCampaigns();
  const placements = getDb().prepare("SELECT id FROM placements WHERE status = 'active' ORDER BY id").all() as { id: string }[];
  const isAdmin = user.role === "admin";

  return (
    <main>
      <Nav user={user} />
      {error && <p className="err">{ERRORS[error] ?? (error.startsWith("invalid_transition") ? "目前狀態不能做這個操作" : error)}</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>活動</th><th>狀態</th><th>版位</th><th>權重</th><th>CPM（TWD）</th><th>排期</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><a href={`/admin/ads/${c.id}`}>{c.name}</a><br /><code>{c.id}</code></td>
                <td><span className={`pill ${c.status}`}>{STATUS[c.status] ?? c.status}</span></td>
                <td>{c.placements ?? "—"}</td>
                <td>{c.weight}</td>
                <td>{c.revenue}</td>
                <td>{fmt(c.starts_at)} ～ {fmt(c.ends_at)}</td>
                <td>
                  {isAdmin && c.status !== "active" && c.status !== "ended" && (
                    <form method="post" action={`/api/admin/ads/${c.id}/publish`} className="inline"><button className="primary">上線</button></form>
                  )}
                  {isAdmin && c.status === "active" && (
                    <form method="post" action={`/api/admin/ads/${c.id}/pause`} className="inline"><button>下架</button></form>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}>尚無活動</td></tr>}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <>
          <h2>新增活動</h2>
          <form method="post" action="/api/admin/ads">
            <div className="grid">
              <label>名稱<input name="name" required /></label>
              <label>版位<select name="placement_id" required>{placements.map((p) => <option key={p.id}>{p.id}</option>)}</select></label>
              <label>權重（1–10）<input name="weight" type="number" min={1} max={10} defaultValue={1} /></label>
              <label>CPM 單價（≥ {cpmFloor()}）<input name="revenue" type="number" min={cpmFloor()} step="any" defaultValue={cpmFloor()} /></label>
              <label>開始<input name="starts_at" type="datetime-local" /></label>
              <label>結束<input name="ends_at" type="datetime-local" /></label>
              <label>每日曝光上限<input name="daily_impression_cap" type="number" min={1} /></label>
            </div>
            <button className="primary">建立（草稿）</button>
          </form>
        </>
      )}
    </main>
  );
}
