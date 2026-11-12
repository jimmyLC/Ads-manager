"use client";
import { useRef } from "react";

/** 「＋ 建立」→ 對話框，送出走原本的表單 POST（建立為草稿）。 */
export default function CreateCampaign({ placements, floor, disabled }: { placements: string[]; floor: number; disabled: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="create sm" disabled={disabled} onClick={() => ref.current?.showModal()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>建立
      </button>
      <dialog ref={ref} className="sheet" onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
        <form method="post" action="/api/admin/ads">
          <div className="card-h">
            <h2>建立行銷活動</h2>
            <button type="button" className="ghost sm" aria-label="關閉" onClick={() => ref.current?.close()}>✕</button>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label className="field">活動名稱<input name="name" required placeholder="例如：Viduck 11 月" /></label>
            <div className="fields">
              <label className="field">版位<select name="placement_id" required>{placements.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label className="field">權重<input name="weight" type="number" min={1} max={10} defaultValue={1} /><span className="hint">1–10，同版位內依權重隨機輪播</span></label>
              <label className="field">CPM 單價（TWD）<input name="revenue" type="number" min={floor} step="any" defaultValue={floor} /><span className="hint">只用於報表估值，最低 {floor}</span></label>
              <label className="field">每日曝光上限<input name="daily_impression_cap" type="number" min={1} placeholder="不限" /></label>
              <label className="field">開始<input name="starts_at" type="datetime-local" /><span className="hint">留空＝立即</span></label>
              <label className="field">結束<input name="ends_at" type="datetime-local" /><span className="hint">留空＝不限</span></label>
            </div>
            <p className="muted small" style={{ margin: 0 }}>建立後是草稿；加好素材（桌機＋手機）再到列表打開開關。</p>
          </div>
          <div className="foot">
            <button type="button" onClick={() => ref.current?.close()}>取消</button>
            <button className="primary">建立草稿</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
