"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { errText, type Tone } from "./ui.ts";

export interface Col { key: string; label: string; num?: boolean }
export interface Row {
  id: string; name: string; href?: string; sub?: string; thumb?: string;
  toggle?: { on: boolean; disabled: boolean } | null;
  status: { tone: Tone; text: string; hint?: string };
  cells: Record<string, string>;
}

/** 開／關：開＝上線（publish）、關＝下架（pause）。成功後重新整理伺服器資料。 */
async function setOn(id: string, on: boolean): Promise<string | null> {
  const r = await fetch(`/api/admin/ads/${id}/${on ? "publish" : "pause"}`, { method: "POST", headers: { accept: "application/json" } });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return errText(j.reason ?? `HTTP ${r.status}`);
}

export default function ManagerTable({ level, cols, rows, totals, totalLabel, canEdit, create }: {
  level: "campaigns" | "creatives" | "placements"; cols: Col[]; rows: Row[]; totals: Record<string, string>; totalLabel: string;
  canEdit: boolean; create?: ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleRows = rows.filter((r) => r.toggle);

  const flip = async (ids: string[], on: boolean) => {
    setErr(null);
    const failed: string[] = [];
    for (const id of ids) {
      setBusy(id);
      const e = await setOn(id, on);
      if (e) failed.push(`${rows.find((r) => r.id === id)?.name ?? id}：${e}`);
    }
    setBusy(null);
    if (failed.length) setErr(failed.join("\n"));
    router.refresh();
  };

  const drill = () => {
    const q = new URLSearchParams(sp.toString());
    q.set("level", "creatives");
    q.set("campaigns", [...sel].join(","));
    router.push(`${path}?${q}`);
  };

  return (
    <>
      <div className="toolbar">
        {level === "campaigns" && create}
        {level === "campaigns" && (
          <>
            <span className="sep" />
            <button className="sm" disabled={!canEdit || !sel.size || !!busy} onClick={() => flip([...sel], true)}>開啟</button>
            <button className="sm" disabled={!canEdit || !sel.size || !!busy} onClick={() => flip([...sel], false)}>關閉</button>
            <button className="sm" disabled={!sel.size} onClick={drill}>查看所選活動的素材</button>
          </>
        )}
        <span className="sp" />
        <span className="muted small">{sel.size ? `已選取 ${sel.size} 個` : `共 ${rows.length} 個`}</span>
      </div>
      {err && <div className="notice err" style={{ margin: 12, whiteSpace: "pre-line" }}>{err}</div>}
      <div className="tbl-wrap">
        <table className={`grid${toggleRows.length ? "" : " no-tog"}`}>
          <thead>
            <tr>
              <th className="c-sel"><input type="checkbox" aria-label="全選" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              {toggleRows.length > 0 && <th className="c-tog">關／開</th>}
              <th className="c-name">{level === "campaigns" ? "行銷活動" : level === "creatives" ? "素材" : "版位"}</th>
              <th>投遞狀態</th>
              {cols.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "sel" : ""}>
                <td className="c-sel"><input type="checkbox" aria-label={`選取 ${r.name}`} checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} /></td>
                {toggleRows.length > 0 && (
                  <td className="c-tog">
                    {r.toggle && (
                      <button
                        type="button" role="switch" className="switch" aria-checked={r.toggle.on} aria-label={`${r.toggle.on ? "關閉" : "開啟"} ${r.name}`}
                        disabled={!canEdit || r.toggle.disabled || busy === r.id}
                        onClick={() => flip([r.id], !r.toggle!.on)}
                      ><span className="track" /><span className="knob" /></button>
                    )}
                  </td>
                )}
                <td className="c-name">
                  <div className="namecell">
                    {r.thumb !== undefined && (r.thumb ? <img className="thumb" src={r.thumb} alt="" /> : <span className="thumb" />)}
                    <div>
                      {r.href ? <a className="name-link" href={r.href}>{r.name}</a> : <span className="name-link">{r.name}</span>}
                      {r.sub && <span className="sub">{r.sub}</span>}
                    </div>
                  </div>
                </td>
                <td>
                  <span className="status"><span className={`dot ${r.status.tone}`} />{r.status.text}</span>
                  {r.status.hint && <span className="sub" style={{ display: "block", color: "var(--mut)", fontSize: 12 }}>{r.status.hint}</span>}
                </td>
                {cols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{r.cells[c.key] ?? "—"}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td className="empty" colSpan={cols.length + 3 + (toggleRows.length ? 1 : 0)}>沒有符合條件的項目</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="c-sel" />
                {toggleRows.length > 0 && <td className="c-tog" />}
                <td className="c-name">{totalLabel}</td>
                <td />
                {cols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{totals[c.key] ?? ""}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
