"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText } from "./ui.ts";

/** 詳細頁上的開／關（開＝上線、關＝下架）。 */
export default function CampaignSwitch({ id, on, disabled }: { id: string; on: boolean; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = async () => {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/admin/ads/${id}/${on ? "pause" : "publish"}`, { method: "POST", headers: { accept: "application/json" } });
    if (!r.ok) setErr(errText((await r.json().catch(() => ({}))).reason ?? `HTTP ${r.status}`));
    setBusy(false);
    router.refresh();
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" role="switch" className="switch" aria-checked={on} aria-label={on ? "關閉活動" : "開啟活動"} disabled={disabled || busy} onClick={flip}>
        <span className="track" /><span className="knob" />
      </button>
      <span className="small muted">{on ? "開啟中" : "已關閉"}</span>
      {err && <span className="small err">{err}</span>}
    </span>
  );
}
