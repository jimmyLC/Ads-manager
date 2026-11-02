# Ads-manager

第一方廣告投放與管理系統，服務 `javis.fyi`（影片站）與 `javid.fyi`（圖片辨識站）。
取代原本兩套各自為政的機制（javis 的 `spotlight`、javid 的 `ads.json`），改為**單一 ad 服務 ＋ 單一 SQLite ＋ 單一後台**。

> 設計原則：同源素材、中性命名、零第三方請求、零 cookie、不存 IP。
> 廣告素材與點擊統計全部在自家網域完成，不引入任何外部廣告網路。

## 特色

- **版位鎖定**：廣告綁定 `site:slot`（網站＋版位），第一版為 `javis:watch-below`、`javid:result-foot`。
- **地區定向**：國別層級（Cloudflare `CF-IPCountry`），未知國別一律不投有國別條件的廣告。
- **統一素材規格**：aspect ratio 16/5（3.2:1）；桌機 1280×400、手機 640×200，同一份素材可跨兩站共用。
- **三種素材**：圖片、原生卡（標題/描述/按鈕）、HTML（僅管理員，sandbox iframe）。
- **計數口徑統一**：serve-time 曝光、點擊同源 302，事件只存每日聚合列。
- **報表**：日期 × 廣告 × 版位 × 國別 × 裝置，可 CSV 匯出、可跨站合計。
- **轉換追蹤**：tracker + 轉換 pixel；支援曝光/點擊目標值與達標自動停。

## 文件

| 文件 | 內容 |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | 完整規格書（架構、資料模型、決策流程、API、尺寸、隱私、權限、上線階段、DoD 測試） |
| [`db/migrations/`](db/migrations/) | SQLite schema 與種子資料 |
| [`docs/openapi.yaml`](docs/openapi.yaml) | API 契約（投放 `/v1/*` ＋ 管理 `/api/admin/*`） |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | 運維手冊（部署、備份、排障、站方接入檢查表） |
| [`docs/CREATIVE-SPEC.md`](docs/CREATIVE-SPEC.md) | 廣告素材規格（給合作方） |

## 架構

```
瀏覽器 ──▶ javis.fyi (Next.js)  ─┐
                                  ├─(127.0.0.1)─▶ Ads-manager (:9090) ──▶ SQLite (/srv/ads/ads.db)
瀏覽器 ──▶ javid.fyi (Next.js)  ─┘                    │
                                                       ├─▶ /srv/ads/assets/（素材）
                                                       └─▶ /admin（Tailscale only，對外 403）
```

站方只做「薄代理」：解析國別與裝置、呼叫投放 API、代理素材與跳轉、渲染元件。
廣告規則與數字只有一份，都住在 ad 服務裡。

## 狀態

規格已定案（v1.0）。實作分六個階段（見 SPEC §11）：**P0 已完成**（骨架、migration＋seed、後台登入／權限／稽核、活動建立與上下架）；**P1 服務端已完成**（`/v1/serve|asset|out|conv|health`、素材上傳與驗證、定向規則、上線前素材檢查）。站方薄代理與 16/5 改版在 javis／javid 兩個 repo，尚未動。

## 開發

```bash
npm install
npm run db:migrate                 # 建立 data/ads.db（或設 ADS_DB_PATH）
npm run user:create -- <名稱> admin   # 隱藏輸入密碼（至少 12 字元）
ADS_INSECURE_COOKIE=1 npm run dev  # http://127.0.0.1:9090/admin（正式環境走 HTTPS，不要設 ADS_INSECURE_COOKIE）
npm test
```

尚未做：TOTP 二因子、站方薄代理（javis／javid repo）、報表／CSV／週報（P3）。
正式環境需設 `APP_SECRET`（素材 token HMAC）；開發環境自動產生 `data/.dev-secret`。素材存放於 `ADS_ASSET_DIR`（預設 `data/assets`）。

## 授權

無 License（public repository，未附授權條款）。
