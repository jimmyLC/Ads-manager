"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PRESETS } from "@/lib/range.ts";

/** 日期區間選擇（預設區間或自訂起迄），改了就換網址、保留其他參數。 */
export default function DateRange({ preset, from, to }: { preset: string; from: string; to: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [custom, setCustom] = useState(preset === "custom");

  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v === null ? q.delete(k) : q.set(k, v));
    router.push(`${path}?${q}`);
  };

  return (
    <div className="range" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--mut)" }}>
        <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
      </svg>
      <select
        aria-label="日期區間"
        value={custom ? "custom" : preset}
        onChange={(e) => {
          if (e.target.value === "custom") return setCustom(true);
          setCustom(false);
          go({ range: e.target.value, from: null, to: null });
        }}
      >
        {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        <option value="custom">自訂…</option>
      </select>
      {custom && (
        <form
          style={{ display: "flex", gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            go({ from: String(f.get("from")), to: String(f.get("to")), range: null });
          }}
        >
          <input type="date" name="from" defaultValue={from} aria-label="起日" required />
          <input type="date" name="to" defaultValue={to} aria-label="迄日" required />
          <button className="sm">套用</button>
        </form>
      )}
      <span className="muted small">{from} – {to}（UTC）</span>
    </div>
  );
}
