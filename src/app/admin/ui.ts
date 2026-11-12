// 後台共用的顯示格式與錯誤訊息
export const nf = (n: number) => n.toLocaleString("zh-TW");
export const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
export const twd = (x: number) => `NT$${x.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dash = (n: number, f: (n: number) => string = nf) => (n ? f(n) : "—");
export const when = (t: number | null) =>
  t ? new Date(t * 1000).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

export const ERRORS: Record<string, string> = {
  name_required: "請填名稱", revenue_below_floor: "CPM 單價低於最低值", bad_date_range: "結束時間早於開始時間",
  no_ready_creative: "每個版位都要至少一個素材齊備（桌機＋手機）才能開啟", placement_required: "請選擇版位", unknown_placement: "版位不存在",
  not_found: "找不到活動", campaign_not_found: "找不到活動", cta_url_must_be_https: "目標網址必須是 https://", alt_required: "圖片素材要填替代文字",
  html_admin_only: "只有管理員能建立 HTML 素材", html_required: "請填 HTML", bad_kind: "素材型態不正確",
  headline_1_60: "標題需 1–60 字", body_1_140: "描述需 1–140 字", cta_label_1_20: "按鈕文字需 1–20 字",
  file_too_large: "檔案太大", unreadable_image: "讀不出圖片（請用 PNG／JPEG／WebP／GIF）", variant_not_allowed_for_kind: "這個素材型態不能用這個變體",
  forbidden: "沒有權限", unauthorized: "請重新登入", bad_origin: "請重新整理頁面再試",
};
export const errText = (e: string) =>
  ERRORS[e] ?? (e.startsWith("invalid_transition") ? "目前狀態不能做這個操作" : e.startsWith("bad_dimensions_expected_") ? `尺寸不符，需要 ${e.slice(24)}` : e);

export type Tone = "ok" | "warn" | "bad" | "sched" | "off";
