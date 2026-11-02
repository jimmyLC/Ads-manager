import type { SessionUser } from "@/lib/auth.ts";

export default function Nav({ user }: { user: SessionUser }) {
  return (
    <nav>
      <strong>Ads-manager</strong>
      <a href="/admin">活動</a>
      {user.role === "admin" && <a href="/admin/audit">稽核軌跡</a>}
      <span className="sp" />
      <span>{user.username}（{user.role === "admin" ? "管理員" : "檢視者"}）</span>
      <form method="post" action="/api/admin/logout" className="inline"><button>登出</button></form>
    </nav>
  );
}
