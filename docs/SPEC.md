# Ads-manager 規格書

> 第一方廣告投放與管理系統（first-party ad serving & management）
> 服務對象：`javis.fyi`（vod 站）、`javid.fyi`（圖片辨識站）
> 版本：v1.0（draft）　狀態：待實作　最後更新：2026-11-03

---

## 0. 摘要

`Ads-manager` 是一套自架的廣告系統，取代目前 javis 的 `spotlight`（SQLite + `/admin/spotlight`）與 javid 的 `ads.json`（檔案式 + `/api/promo/*`），改成**單一 ad 服務＋單一資料庫＋單一後台**，兩個站都從它取廣告。

核心訴求：

1. **同源、中性命名** — 廣告素材與跳轉全部走各站自己的路徑，不引入任何第三方請求，維持既有「零第三方、零 cookie、抗攔截」的紅線。
2. **版位鎖定** — 廣告可綁定到 `site:slot`（網站＋版位），第一版兩個版位：`javis:watch-below`、`javid:result-foot`。
3. **地區定向** — 國別層級（`CF-IPCountry`），不做城市／州省。
4. **統一素材規格** — aspect ratio 統一 16/5（3.2:1），桌機 1280×400、手機 640×200（@2x 各 ×2），同一份素材可跨兩站共用。
5. **隱私優先** — 不存 IP、不存原始 UA、不設 cookie；事件只存每日聚合列。

---

## 1. 目標與非目標

### 1.1 目標

- 取代 javis `spotlight` 與 javid `ads.json` 兩套機制，成為唯一真實來源（single source of truth）。
- 提供一個管理後台，管理：廣告主、活動、素材（圖片／原生卡／HTML）、版位綁定、定向、排期、權重、每日上限、目標值、轉換追蹤器。
- 提供一套投放 API，兩個站以 server-to-server 呼叫取得投放決策，素材與點擊由站方薄代理回應。
- 提供報表與 CSV 匯出，維度：日期 × 廣告 × 版位 × 國別 × 裝置，可跨站合計。
- 素材同源、中性命名，維持既有攔截器免疫與零第三方隱私承諾。
- 資料備份、還原演練、運維手冊齊備。

### 1.2 非目標（本期明確不做）

| 不做 | 理由 |
|---|---|
| 外部廣告主自助註冊／交易／發票／對帳 | 只放自家與友好廣告，不做金流 |
| 多 agency、多租戶、廣告主自助後台 | 單一 operator |
| VAST／VPAID 視頻廣告 | javis 原本就 deferred（M3+ 再談） |
| 城市／州省／郵遞區號等細粒度 geo | 已定案：只到國別 |
| Cookie 型 session cap／頻次控制 | 不設 cookie |
| Popup／interstitial／浮層廣告 | 兩站皆明令不彈窗 |
| CTR 自動最佳化、出價競價（second price） | v1 只做加權隨機；欄位預留 |
| 多機／CDN 加速 | 兩站同機，素材量小 |

### 1.3 與 Revive Adserver 的關係

Revive Adserver（PHP/MariaDB）是最成熟的開源廣告伺服器，本系統在**投放主幹**上與其對齊（組織階層、投放限制、權重、日期窗、曝光上限、報表），但刻意省略「做外部廣告主生意」才需要的部分。逐項對照見 **附錄 A**。

---

## 2. 系統架構與拓撲

### 2.1 拓撲

```
                    ┌──────────────────────── 同一台 VPS（Hetzner CX23, 4GB）─────────────────────────┐
                    │                                                                              │
  瀏覽器            │   javis.fyi (Next.js :8081)          javid.fyi (Next.js :3100)        Ads-manager     │
   │                │        │                                  │                      (Next.js :9090)  │
   │  Cloudflare    │        │ SSR / route handler              │ SSR / route handler              │       │
   │  Tunnel ───────┼────────┤                                  │                              │       │
   │                │        │ ① GET /v1/serve?site=&slot=&country=&device=                  │       │
   │                │        ├──────────────────────────────────┼──────────────────────────────►│       │
   │                │        │                                  │                              │       │
   │                │        │ ② GET /v1/asset/<id>?t=<token>   │ ② 同左                        │       │
   │                │        │◄─────────────────────────────────┼──────────────────────────────┤       │
   │                │        │                                  │                              │       │
   │  素材 GET      │   /api/promo/img/<id>              /api/promo/img/<id>            素材檔實體     │
   │  ─────────────►│   （薄代理，回應 bytes）          （薄代理）                    /srv/ads/assets/  │
   │                │                                  │                              │       │
   │  點擊 GET      │   /api/promo/out/<creativeId>     /api/promo/out/<creativeId>   │       │
   │  ─────────────►│   （薄代理 → ad 服務 302 → 廣告主網址）                          │       │
   │                │                                  │                              │       │
   │                │        ▲                         │        ▲                     │       │
   │                │        └───── 127.0.0.1:9090 ────┘────────┘                     │       │
   │                │                                                                   │       │
   │                │                      SQLite（WAL）:/srv/ads/ads.db                  │       │
   │                │                      管理後台：/admin（Tailscale only，對外 403）    │       │
                    └──────────────────────────────────────────────────────────────────────┘
```

### 2.2 元件職責

| 元件 | 職責 | 明確不做 |
|---|---|---|
| **Ads-manager 服務** | 投放決策、素材儲存、曝光/點擊/轉換計數、報表、管理 API、後台 UI | 不直接對公網提供素材（由站方代理） |
| **站方薄代理** | 解析 client 資訊（IP→國別、UA→裝置）、呼叫 ad 服務、代理素材與跳轉、渲染元件 | 不保存任何廣告規則、不自己抽籤 |
| **管理後台** | 建立/上下架廣告、上傳素材、設定定向與排期、看報表、匯出 CSV | 不對公網開放 |

### 2.3 紅線（違反即為阻斷項）

1. **零第三方**：廣告系統不得產生任何跨網域請求（不引 GA／GTM／像素網域）。既有 GA4 不在本系統範圍。
2. **中性命名**：瀏覽器可見的 class 與路徑不得含 `ad`／`ads`／`advert`／`banner`（EasyList 等會比對）。允許用：`promo`、`spotlight`、`slot`、`promo-slot`、`spotlight-slot`、`/api/promo/*`、`/api/spotlight/*`。
   - javis 維持 `spotlight` 命名（既有 `scripts/blocker-check.ts` 規則不破）。
   - javid 維持 `promo` 命名。
   - ad 服務對外的路徑（`/v1/*`、`/admin/*`）只在 server-to-server 或 Tailscale 使用，不受此限。
3. **同源**：素材與點擊跳轉的 URL 必須是站方自己的網域。
4. **不設 cookie**：投放決策不得依賴 cookie 或 localStorage 識別碼。

### 2.4 請求路徑與快取策略

| 端點 | 呼叫方 | 快取 | 計數 |
|---|---|---|---|
| `GET /v1/serve` | 站方 server（127.0.0.1） | 預設不快取（`serve_cache_ttl_seconds=0`）；若日後啟用，只快取**選稿結果**，計數照常逐次寫入 | 每次 serve 寫一次 impression |
| `GET /v1/asset/<id>` | 站方代理 | 站方回應 `public, max-age=31536000, immutable`（URL 帶版本參數） | — |
| `GET /v1/out/<creativeId>` | 站方代理 | `no-store` | 寫一次 click，302 |
| `GET /v1/conv/<trackerId>` | 廣告主頁面（跨網域允許） | `no-store` | 寫一次 conversion |

---

## 3. 資料模型

SQLite（`node:sqlite`，WAL 模式）。單一寫入者＝Ads-manager 服務。完整 DDL 見 [`schema.sql`](./schema.sql)。

### 3.1 實體關係

```
sites ──1:N── placements
advertisers ──1:N── campaigns ──1:N── creatives ──1:N── creative_assets
                    │  │                        │
                    │  ├──1:N── targeting_rules (country/placement/device/path)
                    │  ├──1:N── trackers
                    │  └──N:M── placements (campaign_placements)
                    │
                    └──1:N── ad_counters (day × campaign × creative × placement × country × device)
```

### 3.2 資料表

| 表 | 用途 | 關鍵欄位 |
|---|---|---|
| `sites` | 站點 | `id`（`javis`/`javid`）、`domain` |
| `placements` | 版位與其尺寸規格 | `id`（`javis:watch-below`）、`width_desktop`/`height_desktop`、`width_mobile`/`height_mobile`、`aspect`（`16/5`） |
| `advertisers` | 廣告主（house/friendly） | `kind` |
| `campaigns` | 活動 | `status`（draft/active/paused/ended）、`weight`、`starts_at`/`ends_at`、`daily_impression_cap`、`target_impression`/`target_click`、`selection_strategy`、`bid_value`、`revenue_type`/`revenue` |
| `targeting_rules` | 定向條件 | `dimension`（country/placement/device/hour/weekday/path）、`operator`（in/not_in/equals）、`value` |
| `campaign_placements` | 活動↔版位 | composite PK |
| `creatives` | 素材 | `kind`（image/native/html）、native 欄位（headline/body/cta_label/cta_url/logo/thumb）、`html`、`alt_text` |
| `creative_assets` | 素材檔變體 | `variant`（desktop/desktop@2x/mobile/mobile@2x）、`width`/`height`、`sha256`、`path` |
| `trackers` | 轉換/回呼追蹤器 | `kind`（callback/pixel）、`url` |
| `ad_counters` | 每日聚合（數字唯一來源） | PK(day, campaign_id, creative_id, placement_id, country, device) |
| `conversions` | 轉換明細 | `tracker_id`、`campaign_id`、`day` |
| `users` | 後台帳號 | `password_hash`（scrypt）、`totp_secret`、`role`（admin/viewer） |
| `sessions` | 後台工作階段 | `expires_at`（不存 IP/UA） |
| `audit_log` | 稽核軌跡 | `actor`、`action`、`object_type`、`object_id`、`detail` |
| `settings` | 鍵值設定 | `serve_cache_ttl_seconds` 等 |

### 3.3 尺寸驗證規則（寫入時強制）

1. `creative_assets.width/height` 必須等於所綁版位該 variant 的規格值（例：desktop = 1280×400）。
2. 同一 `creative` 在同一版位下的所有 variant，`width/height` 比例必須等於該版位 `aspect`（例：640/200 = 3.2 = 1280/400 ✓；1940/500 = 3.88 ✗）。
3. `@2x` variant 必須恰為對應 1x 的兩倍（尺寸與比例皆檢查）。
4. 檔案副檔名白名單：`jpg`/`jpeg`/`png`/`webp`/`gif`（僅 `image` kind）。
5. 檔案大小上限 512KB（桌面）／256KB（手機）；單一素材檔變體上限依上。
6. 上傳時重新計算寬高（不信任副檔名／前端宣告值）→ 解析失敗即拒收。

### 3.4 計數寫入規則

- `ad_counters` 以 UPSERT 累加；`day` 為 UTC 日期（伺服器時區固定 UTC，報表亦用 UTC 日界；站方顯示時再換算）。
- `country`：站方傳入，值為 ISO-2 大寫；無 `CF-IPCountry` 時為 `XX`。
- `device`：站方由 UA 解析後傳入 `desktop|mobile|tablet|unknown`；**ad 服務永不收到也永不儲存原始 UA**。
- `placement_id` 必填；轉換事件若無法得知版位則記 `unknown`。

---

## 4. 投放決策流程

站方呼叫 `GET /v1/serve?site=&slot=&country=&device=`，ad 服務依序執行：

```
1. 解析參數：site, slot, country(ISO-2|XX), device(bucket)
   └─ 對應 placements 查無此 site:slot 或 status≠active → 404 {ok:false, reason:"unknown_placement"}

2. 候選活動集合
   └─ campaigns.status = 'active'
   └─ (starts_at IS NULL OR starts_at ≤ now) AND (ends_at IS NULL OR ends_at ≥ now)

3. 逐活動過濾（任一不符即排除）
   a. targeting_rules：country / placement / device / hour / weekday
      · operator 'in'      → 值必須命中
      · operator 'not_in'  → 值不得命中
      · operator 'equals'  → 完全相等
      · 同一 dimension 多筆 → 全部命中（AND 語意）
      · country 為 XX 時，任何 'country' 條件一律視為不符 → 該活動被排除
        （保守：寧可不投，不可亂投）
      · hour / weekday 以 settings.targeting_timezone（預設 Asia/Taipei）判定；
        hour = 0..23、weekday = 1..7（ISO，1=週一）
   b. 目標值已達：target_impression ≤ 今日累計曝光 或 target_click ≤ 累計點擊 → 排除
   c. 每日上限：daily_impression_cap ≤ 今日累計曝光 → 排除

4. 抽籤：weight 加權隨機（weight 1–10，clamp）

5. 取素材：該活動下 status='active' 且素材齊備的 creative
   （image：desktop 與 mobile variant 皆存在且通過 §3.3 驗證）
   （native：logo/thumb 至少一者存在）
   （html：html 欄位非空）

6. 計曝光：UPSERT ad_counters（day, campaign_id, creative_id, placement_id, country, device）

7. 回應：廣告資料 + 素材 token + 跳轉路徑
```

### 4.1 決策的冪等與失效

- 決策即時計算，**不預先排程**（兩站版位固定、候選少，無需 priority 重算表）。
- 素材 token 有效期 10 分鐘（`HMAC(assetId|expiry, APP_SECRET)`），到期後站方需重新向 ad 服務索取 serve 結果（站方元件本身也會重新取得）。
- 若設定 `serve_cache_ttl_seconds > 0`，僅快取步驟 4 的選稿結果，步驟 6 的計數照常執行。

### 4.2 排除與權重語意

- 多則廣告同版位 → 依 `weight` 加權隨機（v1 不做 CTR 最佳化、不做出價競價）。
- `selection_strategy` 欄位保留；v1 僅允許 `weighted_random`。
- `bid_value`、`revenue_type`、`revenue` 保留但不實作任何計價行為。

---

## 5. API 契約

完整契約見 [`openapi.yaml`](./openapi.yaml)。以下為摘要。

### 5.1 投放 API（僅 127.0.0.1，不需認證；由站方呼叫）

#### `GET /v1/serve`

Query：`site`（必填）、`slot`（必填）、`country`（可選，ISO-2 或 `XX`）、`device`（可選，desktop|mobile|tablet|unknown）

```jsonc
// 200 有廣告
{
  "ok": true,
  "ad": {
    "id": "cr_xxx",
    "campaign_id": "cp_viduck",
    "kind": "image",                 // image | native | html
    "name": "Viduck A",
    "alt": "Viduck 影片下載神器",
    "width": 1280, "height": 400, "aspect": "16/5",
    "image": {
      "desktop": { "asset_id": "as_1", "url": "/api/promo/img/as_1?d=desktop&t=<token>" },
      "mobile":  { "asset_id": "as_2", "url": "/api/promo/img/as_2?d=mobile&t=<token>" }
    },
    "native": null,                  // kind=native 時為 {headline,body,cta_label,cta_url,logo_url,thumb_url}
    "link": { "desktop": "/api/promo/out/cr_xxx?d=desktop", "mobile": "/api/promo/out/cr_xxx?d=mobile" },
    "trackers": ["tk_viduck"]
  }
}
```

```jsonc
// 200 沒有合格廣告（正常情況，非錯誤）
{ "ok": false, "reason": "no_eligible_ad" }
```

錯誤：`404 {"ok":false,"reason":"unknown_placement"}`、`500 {"ok":false,"reason":"internal_error"}`

#### `GET /v1/asset/{assetId}?t={token}`

回應素材 bytes。`token` 驗證失敗 → `403`。站方代理後對瀏覽器回應 `Content-Type` 正確的圖片與 `Cache-Control: public, max-age=31536000, immutable`。

#### `GET /v1/out/{creativeId}?d={desktop|mobile}`

- 寫一次 click（`placement_id` 未知 → 記 `unknown`；`country`/`device` 由站方以 query 帶入，允許缺省）。
- `302` 轉向**資料庫中**的目標網址（不接受任何來自 request 的目標網址 → 無 open redirect 風險）。
- `d=mobile` 時若該 creative 沒有 mobile 連結，落到 desktop 連結。

#### `GET /v1/conv/{trackerId}.gif`

- 1×1 透明 GIF（`Cache-Control: no-store`）。
- 寫 `conversions` 一筆，並對應 campaign 的當日 `ad_counters.conversions` 加一。

#### `GET /v1/health`

`{"ok":true,"db":"ok","version":"...","now":"2026-11-03T00:00:00Z"}`

### 5.2 管理 API（後台使用，需 session cookie）

| 方法 | 路徑 | 說明 |
|---|---|---|
| `GET`/`POST` | `/api/admin/ads` | 列表（可篩 site/placement/status）、建立 |
| `GET`/`PATCH`/`DELETE` | `/api/admin/ads/{id}` | 讀取/更新/刪除（刪除需二次確認） |
| `POST` | `/api/admin/ads/{id}/assets` | 上傳素材變體（multipart，含 `variant` 與 `placement_id`） |
| `POST` | `/api/admin/ads/{id}/publish` | 上線（draft→active），寫 audit |
| `POST` | `/api/admin/ads/{id}/pause` | 下架 |
| `GET`/`POST` | `/api/admin/placements` | 版位列表/建立 |
| `GET`/`POST` | `/api/admin/targeting` | 定向條件 |
| `GET`/`POST` | `/api/admin/trackers` | 追蹤器 |
| `GET` | `/api/admin/stats?from=&to=&groupBy=` | 報表（`groupBy` 可逗號組合） |
| `GET` | `/api/admin/stats.csv?from=&to=&groupBy=` | CSV 匯出（`Content-Disposition: attachment`） |
| `POST` | `/api/admin/users` | 建立帳號（僅 admin） |
| `GET` | `/api/admin/audit` | 稽核軌跡（僅 admin） |

---

## 6. 尺寸與素材規格

### 6.1 版位尺寸（第一版）

| 版位 | 站 | 位置 | 桌機 | 手機 | 比例 |
|---|---|---|---|---|---|
| `javis:watch-below` | javis.fyi | `/watch/[id]` 播放器資訊下方 | 1280×400（@2x 2560×800） | 640×200（@2x 1280×400） | 16/5 |
| `javid:result-foot` | javid.fyi | 辨識結果區塊下方 | 1280×400（@2x 2560×800） | 640×200（@2x 1280×400） | 16/5 |

**統一 16/5（3.2:1）** 的直接後果：

- javis 桌機由 970×250（3.88:1）改為 1280×400；容器寬 970 → 實際渲染 970×303；CSS `aspect-ratio: 97/25` → `16/5`；iframe 素材高度 250 → 303（手機 200 不變）。
- javid 桌機素材 1280×400 **免重製**；既有 1940×500（3.88:1）**廢棄**（比例不符）→ 改 2560×800。
- javid **必須補手機素材** 640×200（@2x 1280×400）——目前手機只會拿到桌機圖（渲染僅 ~117px 高）。
- 兩站比例一致 → **同一份素材可同時投兩個版位**。

### 6.2 素材型態

| kind | 用途 | 必要欄位 | 渲染方式 |
|---|---|---|---|
| `image` | 一般橫幅 | 圖片（desktop+mobile）、alt | `<picture>` + `srcset`（1x/2x），`width:100%; height:auto; aspect-ratio:16/5` |
| `native` | 原生卡（融入版面） | headline、body、cta_label、cta_url、logo 或 thumb | 站方既有卡片元件渲染（深色 UI），非圖片 |
| `html` | 自訂 HTML | `html` | **sandbox iframe**：`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`（不得含 `allow-same-origin`）；僅管理員可建立 |

### 6.3 素材規格（給合作方）

- 格式：JPG / PNG / WebP；≤512KB（桌機）、≤256KB（手機）。
- 尺寸：**必須**符合目標版位規格（桌機 1280×400、手機 640×200），@2x 為其兩倍。
- 比例：同一則廣告的所有變體必須同為 16/5（系統會拒收不符者）。
- 留白：四周至少 40px 留白（避免裁切時切到文字）。
- 文字：深色 UI 站（javid）建議亮字；javis 為淺色 UI，建議深字。至少提供一個可讀對比版本。
- 連結：`rel="sponsored nofollow noopener"`、`target="_blank"`；目標網址須為 https。
- 禁止：彈跳、自動播放、誤導性文案、SFW 內容政策。

### 6.4 原生卡欄位

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `headline` | string(≤60) | 是 | 主標題 |
| `body` | string(≤140) | 是 | 描述 |
| `cta_label` | string(≤20) | 是 | 按鈕文字（如「立即下載」） |
| `cta_url` | url | 是 | 目標網址（https） |
| `logo` | asset | 否 | 品牌小圖（1:1 或 4:3） |
| `thumb` | asset | 否 | 縮圖（16:9） |
| `alt` | string | 是 | 無圖時的替代文字 |

---

## 7. 隱私條款

### 7.1 允許儲存的資料

```
day (UTC) · campaign_id · creative_id · placement_id · country (ISO-2) · device (bucket)
impressions · clicks · conversions
```

### 7.2 禁止儲存／禁止外送

| 禁止項 | 實作方式 |
|---|---|
| 使用者 IP | 不寫入任何表；`CF-IPCountry` 由站方解析後只傳 ISO-2 代碼 |
| 原始 UA | 站方解析成 `desktop/mobile/tablet/unknown` 後只傳 bucket；ad 服務收不到原始 UA |
| Cookie / localStorage 識別碼 | 不使用；投放決策不依賴任何識別碼 |
| 第三方請求 | 素材與跳轉同源；轉換 pixel 僅廣告主頁面會打（非本站流量） |
| 跨域 referrer 外洩 | 素材同源；`Referrer-Policy: strict-origin-when-cross-origin`（站方既有政策） |
| 精細位置 | 不使用經緯度 |
| 跨站追蹤 | 兩站共用同一份廣告資料，但事件維度含 `placement_id`，不做個人級跨站關聯 |

### 7.3 轉換追蹤的例外說明

`/v1/conv/{trackerId}.gif` 會由**廣告主頁面**請求（非本站使用者）。我們只記錄 `tracker_id`、`campaign_id`、`day`、時間戳，**不記 IP、UA、referrer**。轉換 pixel 的存在與否由廣告主決定。

### 7.4 後台保護

- 只綁 **Tailscale**（`tailscale serve` 或 systemd `BindAddress=100.x.x.x`），對外網址一律 `403`。
- 登入：scrypt 密碼雜湊、timing-safe 比對、可選 TOTP 二因子（防重放）、失敗固定延遲、單 IP 限流。
- Session：隨機 id、HttpOnly + SameSite=Strict cookie、預設 8 小時。
- 所有管理動作寫 `audit_log`。

### 7.5 隱私聲明對外文字

javid 現有 `privacy/page.tsx` 需新增一段：「站內廣告為第一方自接，素材與點擊統計皆在本站同源完成，不使用第三方廣告網路、不寫入 Cookie、不儲存 IP；地理 targeting 僅使用 Cloudflare 提供的國家代碼。」

---

## 8. 權限矩陣

| 功能 | 管理員 admin | 檢視者 viewer |
|---|---|---|
| 看後台與報表 | ✅ | ✅ |
| CSV 匯出 | ✅ | ✅ |
| 建立/編輯活動、素材 | ✅ | ❌ |
| 上傳素材 | ✅ | ❌ |
| 上線/下架 | ✅ | ❌ |
| 刪除（廣告/素材/版位） | ✅ | ❌ |
| 建立/停用帳號、TOTP 設定 | ✅ | ❌ |
| 看稽核軌跡 | ✅ | ❌ |
| 修改系統設定 | ✅ | ❌ |

---

## 9. 降級與逾時行為

| 情境 | 行為 |
|---|---|
| ad 服務無回應（逾時 300ms） | 站方直接略過該版位，**整個 slot 不輸出**（不留空白框、不顯示 fallback），server log 記 `ad_service_timeout` |
| ad 服務回 5xx | 同上，記 `ad_service_error` |
| ad 服務回 `no_eligible_ad` | 正常情況，slot 不輸出（無錯誤） |
| 站方讀不到素材檔（代理 404） | 該 slot 不輸出，記 `asset_missing` |
| DB 寫入失敗 | **計數失敗不得影響投放**：log 警告並繼續回應廣告（計數為近似值） |
| DB 完全不可用 | `GET /v1/health` 失敗 → 站方視為服務異常，走逾時分支 |

**不做 fallback**：不保留 javis `spotlight`／javid `ads.json` 當備援，避免雙來源數字不一致；也不放「固定自家廣告」當預設（會掩蓋真實故障）。

---

## 10. 部署與維運

### 10.1 部署

- 位置：Hetzner CX23（既有 VPS），路徑 `/srv/ads`。
- 服務：`ads-web.service`（Next.js standalone，`BindAddress=127.0.0.1`，port 9090）、`ads-maint.timer`（每日 04:40 UTC）。
- 部署方式：沿用既有慣例 `rsync` → `npm ci && npm run build` → `systemctl restart ads-web`。**不引入 Docker、不引入 CI**（沿用兩站現況）。
- 素材：`/srv/ads/assets/<sha256前2位>/<sha256>.<ext>`；檔名帶 hash → URL 天然可 immutable 快取。
- DB：`/srv/ads/ads.db`（WAL）。另設 `ads-web.service` 的 `ProtectSystem`、`NoNewPrivileges`、`PrivateTmp`。

### 10.2 備份與還原

| 對象 | 頻率 | 目的地 | 保留 |
|---|---|---|---|
| `ads.db` | **每日** | 加密後 R2（沿用 javid `r2-backup.sh` 加密流程） | 30 天 |
| `assets/` | 每週 | 加密後 R2 | 30 天 |
| 還原演練 | 每季 | — | — |

> 註：素材備份每週（體積小、變動慢）、DB 每日（很小，複製成本可忽略，且保住報表連續性）。

### 10.3 維運作業

- 每日維護：session 清理、ad_counters 索引檢查、`ads.db` WAL checkpoint。
- 備份：`ads-maint.timer` 觸發；失敗告警走既有 `javis-alerts` Cloudflare Worker（email）。
- 每週報告：週報 email（管理員收），內容為上週各廣告曝光/點擊/點擊率/轉換。

---

## 11. 上線階段

| Phase | 內容 | 驗收點 |
|---|---|---|
| **P0** | repo 骨架、schema＋migration、seed（2 個 placement、house 廣告主、2 則 Viduck 活動）、admin app 登入＋權限＋audit | 可登入、可建立/上下架、audit 有紀錄 |
| **P1** | 投放 API（serve/asset/out/conv/health）、站方薄代理、尺寸改 16/5 | javis `watch-below` 出廣告、圖正確、點擊 302＋計數 |
| **P2** | javid 接上（serve 計數、刪 beacon、補手機素材、aspect-ratio） | javid `result-foot` 出廣告、CLS=0 |
| **P3** | 報表、CSV、週報、目標值自動停、每日 cap 生效 | 數字與手算一致 |
| **P4** | 刪除舊系統（清單見 §12） | 舊路由 404、舊表移除、`blocker-check.ts` 通過 |
| **P5** | DoD 測試全數通過、RUNBOOK 與素材規格頁完成 | §13 全綠 |

---

## 12. 舊系統刪除檢查表

### 12.1 javis（`vod-site`）

- [ ] `packages/db/src/db.ts`：移除 `ads`、`ad_events` 兩張表
- [ ] `packages/db/src/dao.ts`：移除 `AdFull`/`AdInput`/`AdStat` 型別與 `listAds/getAd/createAd/updateAd/deleteAd/setAdImage/pickAdForSlot/countAdImpression/countAdClick/adStats`
- [ ] `apps/web/src/components/AdSlot.tsx`：刪除，改用新元件（元件名維持中性，如 `PromoSlot`）
- [ ] `apps/web/src/app/api/spotlight/**`：刪除（img/out），改由 `/api/promo/**` 代理
- [ ] `apps/web/src/app/admin/spotlight/page.tsx`：刪除
- [ ] `apps/web/src/app/admin/page.tsx`：移除「廣告管理」連結
- [ ] `scripts/ads.test.ts`：刪除（改為新服務的測試）
- [ ] `scripts/blocker-check.ts`：新增 `/api/promo` 與新元件命名的白名單規則
- [ ] `apps/web/src/app/globals.css`：`aspect-ratio: 97/25` → `16/5`；iframe `height: 250px` → `303px`
- [ ] `apps/web/src/app/watch/[id]/page.tsx`：改掛新元件

### 12.2 javid

- [ ] `data/ads/`（`ads.json`、`img/`、`events.jsonl`）：刪除
- [ ] `apps/site/lib/promo.ts`：刪除
- [ ] `apps/site/components/PromoSlot.tsx`：改寫（SSR 取得廣告、serve 計數、刪 beacon）
- [ ] `apps/site/app/api/promo/serve/route.ts`：改為代理 ad 服務
- [ ] `apps/site/app/api/promo/img/[file]/route.ts`：改為代理 ad 服務
- [ ] `apps/site/app/api/promo/go/route.ts`：改為代理 ad 服務的 out
- [ ] `apps/site/app/api/promo/view/route.ts`：**刪除**
- [ ] `apps/site/app/globals.css`：`.promo-slot img` 補 `aspect-ratio: 16/5`
- [ ] `scripts/promo-stats.mjs`：刪除
- [ ] `scripts/vps-sync.sh`：移除 `data/ads` 同步
- [ ] `docs/ADS-PLAN.md`：標記 `superseded by Ads-manager/docs/SPEC.md`

### 12.3 手動重建（非程式遷移）

- [ ] 建立 house 廣告主「Viduck」
- [ ] 建立活動 `Viduck A`／`Viduck B`（slot `javid:result-foot`、weight 1、`from 2026-10-19`、`to 2026-12-31`、active）
- [ ] 上傳素材：桌機 1280×400、手機 640×200（@2x 各 ×2）— 舊的 1940×500 不沿用
- [ ] 連結沿用 `https://viduck.app/go/j-a-sm` / `j-b-sm`

---

## 13. DoD 測試清單

**投放**
- [ ] javis `watch-below` 顯示廣告；javid `result-foot` 顯示廣告
- [ ] 桌機 970/920 容器寬下渲染比例正確（16/5）、高度正確（303 / 287.5）
- [ ] 手機（375px）下使用 mobile 素材，渲染 375×117
- [ ] 同一素材可同時投兩站，比例無變形
- [ ] adblock ON/OFF 兩態都顯示（class/path 無 ad/banner 字樣）
- [ ] CLS = 0（固定高度預留；javid 補 `aspect-ratio`）

**計數**
- [ ] 點擊 → 302 → 目標網址正確，且 click +1
- [ ] 曝光在 serve 端計數（javid 無 `/api/promo/view`）
- [ ] 重新整理會再計一次（口徑已知，見 §14）
- [ ] 國別維度正確（以 `CF-IPCountry` 模擬 TW/JP/US）
- [ ] 裝置維度正確（桌機/手機 UA）

**規則**
- [ ] `country` 條件：非目標國別不出
- [ ] `not_in` 條件：被排除的版位不出
- [ ] `hour` 條件：非指定小時不出（時區 Asia/Taipei）
- [ ] `weekday` 條件：非指定星期不出（ISO 1=週一…7=週日）
- [ ] `from`/`to` 到期自動下架
- [ ] 每日曝光上限生效（達上限後不出）
- [ ] 目標值達標自動停

**報表與匯出**
- [ ] 維度：日期 × 廣告 × 版位 × 國別 × 裝置
- [ ] 近 7/30 天切換
- [ ] 跨站合計
- [ ] CSV 匯出可被 Excel 開啟且數字與畫面一致

**可靠性與安全**
- [ ] ad 服務停止 → 站點版位整個不輸出、不留白框、頁面無 JS 錯誤
- [ ] 逾時 300ms 生效
- [ ] 素材 token 過期或竄改 → 403
- [ ] 圖片副檔名／尺寸／比例不符 → 上傳被拒
- [ ] HTML 素材僅管理員可建立，且以 sandbox iframe 渲染
- [ ] 後台對外 403；Tailscale 內可登入；TOTP 可啟用
- [ ] 所有管理動作寫入 audit_log
- [ ] DB 備份可還原（演練一次）

**隱私**
- [ ] 全站 grep 無第三方廣告／統計網域
- [ ] DB 中無 IP、無 UA 欄位資料
- [ ] 無 cookie 用於投放決策
- [ ] 素材與跳轉為同源網域

---

## 14. 已知取捨

| 取捨 | 影響 | 缓解 |
|---|---|---|
| SSR 口徑曝光（不做 viewability） | 分母偏大、CTR 偏低 | 已與兩站口徑一致；javid 口徑變更日期寫入報表說明 |
| 重新整理重複計曝光 | 曝光數高於「不重複人數」 | 只做內部廣告成效參考，不做跨站去重 |
| 國別來自 IP | VPN/Proxy 會失真 | 只到國別層級，失真影響小；`XX` 一律不投有國別條件的廣告 |
| 站方解析 UA | 桌面瀏覽器縮窄視窗可能被判為 mobile（依 breakpoint 640px） | 兩站 breakpoint 一致 |
| 素材備份每週 | 素材遺失最多回溯 7 天（素材可重上） | DB 每日備份 |
| 轉換只歸因到 campaign，不歸因到單次點擊 | v1 的 tracker 直接綁 campaign，pixel 不帶點擊識別碼 → 無法算出「點擊→轉換」的時間差或單次點擊的轉換率 | 擴充點見 §15（加 `click_id`，仍不需 cookie） |

---

## 15. 未來擴充點（不在 v1 範圍）

- `selection_strategy`：`ctr_optimized`、`declared_value`（second price）— 欄位已留。
- `revenue_type` / `revenue`：合作方按 CPM/CPC/固定價計算 — 欄位已留。
- 細粒度 geo（MaxMind GeoLite2 離線 mmdb，國＋州省＋城市）— geo 模組介面已抽象。
- **內部計價（若需要分帳）**：建議以 **CPM** 為唯一計價單位（曝光是我們唯一能穩定交付的量，點擊受攔截器與使用者行為影響、轉換需對方回報 → 適合當成效指標而非計價單位）。做法只是把 `campaigns.revenue_type='cpm'` 與 `revenue` 開起來，報表加「價值 = revenue/1000 × impressions」與 eCPM 欄位；不涉及扣款、發票、對帳流程。
- **點擊歸因（click_id）**：點擊跳轉時附加隨機 `click_id`（不含個資、不設 cookie），廣告主回報轉換時帶回 → 可算出「點擊→轉換」時間差與單次點擊轉換率（對應 Revive 的 connection 模型）。
- `path` 維度（頁面路徑條件）— 欄位已留，UI 未開放。
- Channel（可重用定向規則集）。
- 多站接入（新增 `sites`/`placements` 即可）。
- 外部廣告主自助後台（多租戶、權限細分）。
- VAST/視頻廣告（需網站身份專用廣告帳號）。
- CDN/多機部署（素材改存 R2 公開網域時會犧牲同源，改以 token 保護）。

---

## 附錄 A：與 Revive Adserver 對照

| Revive 功能 | v1 | 備註 |
|---|---|---|
| Advertiser→Campaign→Banner 階層 | ✅ | 命名為 advertiser→campaign→creative |
| Publisher→Zone | ✅ | 命名為 site→placement |
| 投放限制（ACL）機制 | 部分 | 26 種 → 本系統 5 種（country/placement/device/path＋not_in） |
| Channel 可重用規則集 | ❌ | 不需要 |
| Client 維度（UA/OS/語言/IP/瀏覽器版本） | 部分 | 只做 device bucket |
| Geo 10 維度 | 部分 | 只做 country |
| Site 維度（hostname/page URL/referrer/source/variable） | 部分 | placement 綁定 + path 欄位（未開放 UI）＋素材 token 防盜鏈 |
| Time 維度（日期/星期/時段） | ✅ | from/to＋時段/星期規則 |
| 權重、日期窗、優先序 | 部分 | weight＋from/to（無 campaign 優先序） |
| 曝光上限（多層）、session cap、block cap | 部分 | 只做 campaign 每日曝光上限 |
| 曝光/點擊/轉換計數 | ✅ | 全部支援 |
| Tracker（回呼/轉換 pixel） | ✅ | |
| 目標值達標自動停 | ✅ | |
| 收入模型（revenue_type/eCPM） | 欄位 | 不實作 |
| 4 種標準報表 + 30+ report builder | 部分 | 1 張聚合查詢 + CSV + 週報 |
| Email 報告排程 | ✅ | |
| 廣告格式（image/text/interstitial/HTML5/VAST） | 部分 | image＋native＋html(iframe)；無 VAST/text/interstitial |
| 呼叫標籤（adjs/adframe/adpopup/local mode） | 部分 | 僅 SSR + serve |
| 4 種角色 / 多 agency | 部分 | 2 種角色 / 單 agency |
| Plugin 生態 / 模板系統 | ❌ | 不需要 |
| 優先序重算維護 | ❌ | 即時決策，不需要 |
| Fraud / click 驗證 | ❌ | 僅自家廣告，風險低 |

---

## 附錄 B：決策紀錄（設計決策摘要）

| # | 決策 | 結論 |
|---|---|---|
| 1 | 系統範圍 | 單一後台 ＋ 單一 DB |
| 2 | 商業模式 | 只放自家/友好廣告，不做交易 |
| 3 | 舊系統 | 完全取代、資料不遷移；Viduck 兩則手動重建 |
| 4 | 鎖定粒度 | `site:slot`；path 欄位保留 |
| 5 | 地區定向 | 國別 only（CF-IPCountry）；未知國別不投 |
| 6 | 技術棧 | TypeScript/Node 22 + SQLite（WAL）+ systemd/rsync |
| 7 | 後台使用者 | admin / viewer 兩角色 |
| 8 | 計數粒度 | 日期 × 廣告 × 版位 × 國別 × 裝置 |
| 9 | 服務拓撲 | 獨立 ad 服務 ＋ 站方薄代理（同源、中性命名） |
| 10 | 素材型態 | image + native 正式支援；html 僅管理員 |
| 11 | 排程輪替 | weight + from/to + 每日上限 + 每版位 1 則 |
| 12 | 競價 | 只做加權隨機；`selection_strategy`/`bid_value` 預留 |
| 13 | 曝光口徑 | serve-time（SSR 口徑），javid 改為伺服器端計數 |
| 14 | 尺寸 | 統一 16/5；桌機 1280×400、手機 640×200 |
| 15 | 素材儲存 | VPS 本地 `/srv/ads/assets` |
| 16 | 發布流程 | 草稿 → 管理員上線；audit log |
| 17 | 後台保護 | Tailscale only + 403 public + scrypt/TOTP |
| 18 | 後台位置 | 獨立 admin app |
| 19 | 降級 | 逾時 300ms；slot 不輸出；無 fallback |
| 20 | 備份 | DB 每日、素材每週、加密 R2、保留 30 天 |
| 21 | 轉換追蹤 | 納入 v1（tracker + 轉換 pixel） |
| 22 | 目標值 | 納入 v1（曝光/點擊目標 + 達標自動停） |
| 23 | 素材防盜鏈 | 納入 v1（短期 HMAC token） |
| 24 | 排除運算子 | 納入 v1（not_in）＋時段/星期定向 |
| 25 | 快取/除錯 | 納入 v1（serve 快取開關預設 0 ＋ debug log） |
| 26 | 週報 | 納入 v1（email，每週一） |
