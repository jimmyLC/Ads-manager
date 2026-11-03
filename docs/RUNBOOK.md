# Ads-manager 運維手冊（RUNBOOK）

> 對應規格書 [`SPEC.md`](./SPEC.md) v1.0。適用環境：Hetzner CX23（與 javis/javid 同一台 VPS）。

---

## 1. 部署

### 1.1 首次部署

```bash
# 1. 取得程式
sudo mkdir -p /srv/ads && sudo chown $USER:$USER /srv/ads
git clone https://github.com/jimmyLC/Ads-manager.git /srv/ads/app
cd /srv/ads/app

# 2. 安裝與建置
npm ci
npm run build

# 3. 初始化 DB（會套用 db/migrations/ 的 schema 與種子）
node scripts/migrate.mjs

# 4. 素材目錄
sudo mkdir -p /srv/ads/assets && sudo chown $USER:$USER /srv/ads/assets

# 5. 環境變數（放 /srv/ads/.env，權限 600）
#    APP_SECRET=<64 hex>            素材 token HMAC 與 session 簽章用
#    ADMIN_BOOTSTRAP_USER=admin
#    ADMIN_BOOTSTRAP_PASSWORD=<隨機>
#    ADMIN_TOTP_SECRET=<base32>     可留空，之後在後台啟用
#    GA4_PROPERTY_ID_JAVIS=G-J8X3V9GXR4
#    GA4_API_SECRET_JAVIS=<每個 data stream 各自的 API secret>
#    GA4_PROPERTY_ID_JAVID=<javid 的 GA4 property>
#    GA4_API_SECRET_JAVID=<...>
```

### 1.2 systemd

`/etc/systemd/system/ads-web.service`

```ini
[Unit]
Description=Ads-manager ad serving
After=network.target

[Service]
Type=simple
User=ads
Group=ads
WorkingDirectory=/srv/ads/app
EnvironmentFile=/srv/ads/.env
ExecStart=/usr/bin/node /srv/ads/app/standalone/server.js
Environment=PORT=9090
Environment=HOSTNAME=127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/ads/assets /srv/ads/data

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/ads-maint.timer`

```ini
[Unit]
Description=Ads-manager daily maintenance

[Timer]
OnCalendar=*-*-* 04:40:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

啟用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ads-web.service ads-maint.timer
sudo systemctl status ads-web.service
curl -s http://127.0.0.1:9090/v1/health
```

### 1.3 日常更新

沿用兩站既有流程（rsync + build + restart），**不走 CI**：

```bash
# 本機
rsync -az --delete --exclude node_modules --exclude .git \
  ./ /srv/ads/app/            # 或直接 git pull on server
ssh ads-prod 'cd /srv/ads/app && npm ci && npm run build && systemctl restart ads-web'
ssh ads-prod 'curl -s http://127.0.0.1:9090/v1/health'
```

### 1.4 後台對外封鎖

- 後台只綁 Tailscale：`sudo tailscale serve --bg http://127.0.0.1:9090`（僅 Tailscale 網路可達）。
- 若有人嘗試從公網打管理路徑 → middleware 一律回 `403`（不顯示登入頁）。
- 不要把 9090 直接開防火牆。

---

## 2. 監控與告警

| 項目 | 檢查方式 | 異常處置 |
|---|---|---|
| 服務存活 | `curl /v1/health` | `systemctl restart ads-web`；查 `journalctl -u ads-web -n 200` |
| 每日曝光異常為 0 | `GET /api/admin/stats?from=<yesterday>&to=<yesterday>` | 檢查站方代理是否在呼叫 serve |
| 備份成功 | `journalctl -u ads-maint -n 100` | 手動重跑備份腳本 |
| 磁碟 | `df -h /srv/ads` | 清理舊素材（無引用的 hash 檔） |

告警沿用既有 `javis-alerts` Cloudflare Worker（email）。

---

## 3. 備份與還原

### 3.1 備份

由 `ads-maint.timer` 觸發 `scripts/backup.sh`：

- **DB 每日**：`sqlite3 ads.db ".backup /tmp/ads.db"` → 加密（沿用 javid `r2-backup.sh` 的加密方式）→ R2。
- **素材每週**：`assets/` 打包 → 加密 → R2。
- 保留 30 天。

### 3.2 還原演練（每季一次）

```bash
# 1. 下載最近一份備份並解密
# 2. 還原到暫存位置驗證
sqlite3 /tmp/restore_test.db "PRAGMA integrity_check;"   # 必須回 ok
sqlite3 /tmp/restore_test.db "SELECT COUNT(*) FROM ad_counters;"
# 3. 驗證 ads.db 可被服務讀取後才覆蓋正式庫
```

**不要**在服務運行中直接覆蓋 `ads.db`（WAL 會不一致）。正確流程：停服務 → 覆蓋 → 啟動 → `PRAGMA integrity_check`。

---

## 4. 疑難排解：廣告沒有出來

依序檢查：

1. **站方有沒有呼叫 ad 服務？**
   `journalctl -u ads-web | grep '/v1/serve'` 或在 ad 服務開 `serve_debug_log` → ring buffer（`GET /v1/health` 附最近請求摘要）。
2. **版位是否存在？** 呼叫 `GET /v1/serve?site=javis&slot=watch-below&country=TW&device=desktop`，看是否 `404 unknown_placement`。
3. **回應是否 `no_eligible_ad`？** 逐項排除：
   - 活動 `status` 是不是 `active`？（草稿不會出）
   - `starts_at` / `ends_at` 是否涵蓋現在？（注意 **UTC**）
   - `daily_impression_cap` 是否已達？
   - `target_impression` / `target_click` 是否已達？
   - `targeting_rules`：有 `country` 條件但請求 `country=XX` → **一定被排除**（設計如此）。
   - `not_in` 是否把這個版位排除了？
   - `campaign_placements` 是否綁到這個版位？
   - 素材是否齊備（image 需 desktop+mobile 兩個 variant 都在且通過尺寸驗證）？
4. **國別判定**：站方取 `CF-IPCountry`；沒有此標頭（直連、非 Cloudflare 流量）→ `XX` → 有國別條件的廣告不會出。
5. **裝置判定**：UA 解析 breakpoint 640px；桌機瀏覽器視窗縮窄可能被判為 mobile（不影響有無，只影響維度）。
6. **素材取不到**：站方代理是否轉發 token？token 有效期 10 分鐘 → 過期需重新取得 serve 結果。
7. **被攔截器擋掉**：跑站方的 `scripts/blocker-check.ts`；確認 class/path 沒含 `ad`/`ads`/`banner`。
8. **數字對不上**：報表讀 `ad_counters`；曝光在 serve 端寫入，若站方快取或重複呼叫 serve，數字會高於實際顯示。

---

## 4. 疑難排解：GA4 收不到廣告轉換事件

1. **outbox 有沒有待送？** `SELECT ga4_status, COUNT(*) FROM conversions GROUP BY ga4_status;`
   - `pending` 堆積 → flush 排程沒跑（檢查 `ads-maint.timer` 的每分鐘 flush 與 `journalctl -u ads-maint`）。
   - `failed` → 看 `ga4_error` 欄位內容。
2. **憑證對不對？** `GA4_API_SECRET_*` 是**每個 data stream 各自的** secret（GA4 後台「管理 → 資料串流 → API 金鑰」），不是 Property 層級的。換 stream 就會失效。
3. **Property ID 對不對？** `settings.ga4_property_javis` / `ga4_property_javid`。
4. **事件有送出但 GA4 看不到？**
   - 自訂參數（`ad_campaign_id` / `ad_creative_id` / `ad_placement` / `ad_country` / `ad_tracker_id`）必須先在 GA4 **註冊為 event-scoped custom dimension** 才會出現在標準報表。
   - `ad_conversion` 需在 GA4 後台**標記為 key event**。
   - MP 事件不會即時出現在「即時」報表，且**地理維度會算在 VPS（赫辛基）** → 地理請看 `ad_country` 或我們自己的報表。
5. **GA4 掛掉會影響投放嗎？** 不會。轉換先寫我們自己的 `conversions` 與 `ad_counters`，GA4 只是 outbox 副本（SPEC §5.4）。

---

## 5. 例行作業

| 週期 | 作業 |
|---|---|
| 每日 | 檢查 `/v1/health`、備份成功、昨日曝光數、GA4 outbox 是否積壓 |
| 每週 | 素材備份；寄出週報（含 CSV 附件）；檢查失敗的排程（上架/下架） |
| 每月 | 清 `sessions` 過期資料（自動）、`audit_log` 保留 180 天後清理、確認 TOTP 已啟用 |
| 每季 | 還原演練；檢視已失效的 campaign（`ends_at` 已過但仍 active）並下架 |

---

## 6. 金鑰與設定

| 項目 | 位置 | 輪替 |
|---|---|---|
| `APP_SECRET` | `/srv/ads/.env`（600） | 輪替會使既有素材 token 與 session 失效（可接受，低峰期做） |
| `ADMIN_TOTP_SECRET` | `/srv/ads/.env` 與 `users.totp_secret` | 後台重綁 |
| 資料庫 | `/srv/ads/data/ads.db` | — |

**任何設定都不得寫進程式碼、URL 或版本庫**（沿用兩站既有 fail-closed 規範）。

---

## 7. 站方接入檢查表

- [ ] 站方呼叫 `GET /v1/serve`，逾時 300ms
- [ ] 站方解析 `CF-IPCountry` → ISO-2（缺 → `XX`）
- [ ] 站方解析 UA → device bucket（不外傳原始 UA）
- [ ] 素材路由以**中性命名**代理 ad 服務（不得含 ad/banner 字樣）
- [ ] 點擊路由代理 ad 服務的 out（目標網址由 ad 服務的 DB 決定，站方不接受外部指定的目標）
- [ ] 渲染時固定高度 + `aspect-ratio: 16/5` → CLS = 0
- [ ] ad 服務不可用時，版位整個不輸出（不留白框）
- [ ] 兩站樣式：`rel="sponsored nofollow noopener"`、`target="_blank"`

## 附：報表與排程指令（P3）

| 指令 | 用途 | 建議排程 |
|---|---|---|
| `npm run maint` | 到期／達目標的活動標為 ended、清過期 session、WAL checkpoint | 每日 04:40 UTC（`ads-maint.timer`） |
| `npm run report:weekly [-- --out <dir>]` | 產出上一個完整週（週一至週日，UTC）的 CSV 與文字摘要，預設放 `data/outbox/` | 每週一 |
| `npm run blocker-check` | 對照四份廣告攔截清單，確認版位不被擋（見 `tools/blocker-check/`） | 改版位命名後 |

週報目前只產生檔案；寄信管道（例如走既有 `javis-alerts`）尚未接上。報表日界為 UTC，與台北差 8 小時。
