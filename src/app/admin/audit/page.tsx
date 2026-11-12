import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import Shell from "../Shell.tsx";
import { when } from "../ui.ts";

export const dynamic = "force-dynamic";

const ACTION: Record<string, string> = {
  create: "建立", login: "登入", logout: "登出", login_failed: "登入失敗", publish: "開啟", pause: "關閉", end: "結束", upload: "上傳", delete: "刪除", update: "修改",
};

export default async function AuditPage() {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "admin") redirect("/admin");
  const rows = getDb().prepare("SELECT * FROM audit_log ORDER BY ts DESC, id DESC LIMIT 200").all() as {
    id: number; ts: number; actor: string; action: string; object_type: string; object_id: string; detail: string | null;
  }[];
  return (
    <Shell user={user} section="audit" title="稽核軌跡">
      <div className="card">
        <div className="card-h"><h2>最近 200 筆</h2></div>
        <div className="tbl-wrap">
          <table className="grid">
            <thead><tr><th>時間（台北）</th><th>操作者</th><th>動作</th><th>對象</th><th>內容</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.ts)}</td>
                  <td>{r.actor}</td>
                  <td>{ACTION[r.action] ?? r.action}</td>
                  <td>{r.object_type} <code>{r.object_id}</code></td>
                  <td style={{ whiteSpace: "normal", maxWidth: 480 }}><code>{r.detail}</code></td>
                </tr>
              ))}
              {!rows.length && <tr><td className="empty" colSpan={5}>沒有紀錄</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
