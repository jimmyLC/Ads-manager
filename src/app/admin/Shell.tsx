import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth.ts";

const ICONS = {
  manage: <path d="M4 5h16M4 12h16M4 19h10" strokeLinecap="round" />,
  reports: <path d="M5 20V10m7 10V4m7 16v-7" strokeLinecap="round" />,
  audit: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" strokeLinecap="round" /></>,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" strokeLinecap="round" strokeLinejoin="round" />,
};
export const Icon = ({ d }: { d: keyof typeof ICONS }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICONS[d]}</svg>
);

type Section = "manage" | "reports" | "audit";

/** 後台外框：左側導覽列 + 頂列（比照 Meta 廣告管理員）。 */
export default function Shell({ user, section, title, actions, children }: {
  user: SessionUser; section: Section; title: string; actions?: ReactNode; children: ReactNode;
}) {
  const link = (s: Section, href: string, label: string) => (
    <a href={href} className={section === s ? "on" : ""} aria-label={label}>
      <Icon d={s} /><span className="tip">{label}</span>
    </a>
  );
  return (
    <div className="app">
      <nav className="rail">
        <div className="logo" title="Ads-manager">A</div>
        {link("manage", "/admin", "廣告管理")}
        {link("reports", "/admin/reports", "報表")}
        {user.role === "admin" && link("audit", "/admin/audit", "稽核軌跡")}
        <span className="sp" />
        <form method="post" action="/api/admin/logout">
          <button className="ghost" aria-label="登出" title="登出" style={{ width: 40, padding: 0, justifyContent: "center" }}><Icon d="logout" /></button>
        </form>
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="title">{title}</div>
          <span className="sp" />
          {actions}
          <div className="who">
            <span>{user.username}・{user.role === "admin" ? "管理員" : "檢視者"}</span>
            <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
