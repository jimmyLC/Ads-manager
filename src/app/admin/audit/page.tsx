import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import Nav from "../Nav.tsx";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "admin") redirect("/admin");
  const rows = getDb().prepare("SELECT * FROM audit_log ORDER BY ts DESC, id DESC LIMIT 200").all() as {
    id: number; ts: number; actor: string; action: string; object_type: string; object_id: string; detail: string | null;
  }[];
  return (
    <main>
      <Nav user={user} />
      <h2>稽核軌跡（最近 200 筆）</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>對象</th><th>內容</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.ts * 1000).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}</td>
                <td>{r.actor}</td><td>{r.action}</td><td>{r.object_type} <code>{r.object_id}</code></td>
                <td><code>{r.detail}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
