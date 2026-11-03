-- Ads-manager schema (SQLite / node:sqlite)
-- 對應 docs/SPEC.md §3。WAL 模式，單一寫入者＝Ads-manager 服務。
-- 版本：v1.0  最後更新：2026-11-03

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ---------------------------------------------------------------------------
-- 站點
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
  id          TEXT PRIMARY KEY,              -- 'javis' | 'javid'
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- 版位（含尺寸規格；比例統一 16/5 = 3.2:1）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS placements (
  id              TEXT PRIMARY KEY,          -- 'javis:watch-below'
  site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slot            TEXT NOT NULL,             -- 'watch-below'
  status          TEXT NOT NULL DEFAULT 'active',   -- active | paused
  width_desktop   INTEGER NOT NULL,
  height_desktop  INTEGER NOT NULL,
  width_mobile    INTEGER NOT NULL,
  height_mobile   INTEGER NOT NULL,
  aspect          TEXT NOT NULL DEFAULT '16/5',
  description     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (site_id, slot)
);

-- ---------------------------------------------------------------------------
-- 廣告主（house = 自家 / friendly = 友好合作方）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advertisers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'house',   -- house | friendly
  contact     TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- 活動
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id                    TEXT PRIMARY KEY,
  advertiser_id         TEXT NOT NULL REFERENCES advertisers(id) ON DELETE RESTRICT,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft',  -- draft | active | paused | ended
  weight                INTEGER NOT NULL DEFAULT 1,      -- 1..10，加權隨機
  starts_at             INTEGER,                        -- epoch 秒，NULL = 不限
  ends_at               INTEGER,
  daily_impression_cap  INTEGER,                        -- NULL = 不限
  target_impression     INTEGER,                        -- 達標自動停
  target_click          INTEGER,
  selection_strategy    TEXT NOT NULL DEFAULT 'weighted_random',
  bid_value             REAL,                           -- 預留，v1 不實作
  revenue_type          TEXT NOT NULL DEFAULT 'cpm',    -- cpm | cpc | cpa（flat v1 不支援）
  revenue               REAL NOT NULL DEFAULT 30,       -- CPM 單價（TWD / 1000 次曝光），不得低於 settings.cpm_floor_twd
  currency              TEXT NOT NULL DEFAULT 'TWD',    -- 幣別
  notes                 TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  created_by            TEXT,
  updated_by            TEXT
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status   ON campaigns(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser ON campaigns(advertiser_id);

-- ---------------------------------------------------------------------------
-- 定向條件
--   dimension: country | placement | device | hour | weekday | path
--              path    保留欄位，v1 UI 未開放
--              hour    0..23（本地小時，依 settings.targeting_timezone 判定）
--              weekday 1..7（ISO：1=週一 … 7=週日）
--   operator : in | not_in | equals
--   value    : 逗號分隔（in/not_in）或單值（equals）
--   同一 dimension 可有多筆 → 全部必須命中（AND 語意）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS targeting_rules (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  dimension    TEXT NOT NULL,
  operator     TEXT NOT NULL,
  value        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_targeting_campaign ON targeting_rules(campaign_id);

-- ---------------------------------------------------------------------------
-- 活動 ↔ 版位
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_placements (
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, placement_id)
);

-- ---------------------------------------------------------------------------
-- 素材（創意）
--   kind = image : 用 creative_assets 的圖片 + alt_text
--   kind = native: 用 headline/body/cta_label/cta_url + logo/thumb
--   kind = html  : 用 html（僅管理員可建立；sandbox iframe 渲染）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creatives (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                     -- image | native | html
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',     -- draft | active | paused
  alt_text     TEXT,
  headline     TEXT,                              -- native
  body         TEXT,                              -- native
  cta_label    TEXT,                              -- native
  cta_url      TEXT,                              -- native
  logo_asset_id    TEXT,                          -- native
  thumb_asset_id   TEXT,                          -- native
  html         TEXT,                              -- html
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  created_by   TEXT,
  updated_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_creatives_campaign ON creatives(campaign_id, status);

-- ---------------------------------------------------------------------------
-- 素材檔變體
--   variant: desktop | desktop@2x | mobile | mobile@2x
--   規則（寫入時強制，見 SPEC §3.3）：
--     1. 尺寸須等於所綁版位對應 variant 規格
--     2. 同一 creative 在同一版位的所有 variant 比例須等於版位 aspect
--     3. @2x 須恰為對應 1x 的兩倍
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creative_assets (
  id            TEXT PRIMARY KEY,
  creative_id   TEXT NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  placement_id  TEXT NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  variant       TEXT NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  path          TEXT NOT NULL,                   -- 相對於 /srv/ads/assets
  content_type  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_creative  ON creative_assets(creative_id);
CREATE INDEX IF NOT EXISTS idx_assets_placement ON creative_assets(placement_id);

-- ---------------------------------------------------------------------------
-- 追蹤器（轉換 / 回呼）
--   kind = callback : 服務端請求 url（帶 {click_id} 佔位）
--   kind = pixel    : 廣告主頁面打 /v1/conv/<id>.gif
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trackers (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  url          TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trackers_campaign ON trackers(campaign_id);

-- ---------------------------------------------------------------------------
-- 每日聚合（數字的唯一來源）
--   PK(day, campaign_id, creative_id, placement_id, country, device)
--   country: ISO-2；未知為 'XX'（XX 不會命中任何 country 條件）
--   device : desktop | mobile | tablet | unknown（僅桶，不存原始 UA）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_counters (
  day          TEXT NOT NULL,                    -- UTC 日期 YYYY-MM-DD
  campaign_id  TEXT NOT NULL,
  creative_id  TEXT NOT NULL,
  placement_id TEXT NOT NULL,                    -- 未知時 'unknown'
  country      TEXT NOT NULL DEFAULT 'XX',
  device       TEXT NOT NULL DEFAULT 'unknown',
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  conversions  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, campaign_id, creative_id, placement_id, country, device)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_counters_campaign_day ON ad_counters(campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_counters_placement_day ON ad_counters(placement_id, day);

-- ---------------------------------------------------------------------------
-- 轉換明細（ad_counters.conversions 的來源）
--   同時是 GA4 Measurement Protocol 的 outbox（見 SPEC §5.4）
--   ga4_status: pending | sent | failed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  day          TEXT NOT NULL,
  tracker_id   TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  campaign_id  TEXT NOT NULL,
  source       TEXT NOT NULL,                    -- pixel | callback
  click_id     TEXT,                             -- 預留：點擊歸因（見 SPEC §15），v1 不填
  ga4_status   TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  ga4_sent_at  INTEGER,
  ga4_attempts INTEGER NOT NULL DEFAULT 0,
  ga4_error    TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversions_campaign_day ON conversions(campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_conversions_ga4_pending   ON conversions(ga4_status, id);

-- ---------------------------------------------------------------------------
-- 後台帳號與工作階段（不存 IP / UA）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,                  -- scrypt: N$r$p$salt$hash
  totp_secret    TEXT,                           -- 加密儲存
  totp_enabled   INTEGER NOT NULL DEFAULT 0,
  role           TEXT NOT NULL DEFAULT 'viewer', -- admin | viewer
  disabled       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip_hash    TEXT                               -- sha256(ip + app_salt)，僅供異常偵測，30 天後清除
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 稽核軌跡
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  actor        TEXT NOT NULL,                    -- username
  action       TEXT NOT NULL,                    -- create | update | delete | publish | pause | login | logout
  object_type  TEXT NOT NULL,
  object_id    TEXT NOT NULL,
  detail       TEXT                              -- JSON diff
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

-- ---------------------------------------------------------------------------
-- 設定
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- 種子資料
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO sites (id, name, domain, created_at, updated_at) VALUES
  ('javis', 'JAVIS', 'javis.fyi',  0, 0),
  ('javid', 'JAVID', 'javid.fyi',  0, 0);

INSERT OR IGNORE INTO placements
  (id, site_id, slot, status, width_desktop, height_desktop, width_mobile, height_mobile, aspect, description, created_at, updated_at) VALUES
  ('javis:watch-below', 'javis', 'watch-below', 'active', 1280, 400, 640, 200, '16/5', '播放器資訊下方', 0, 0),
  ('javid:result-foot', 'javid', 'result-foot', 'active', 1280, 400, 640, 200, '16/5', '辨識結果下方', 0, 0);

INSERT OR IGNORE INTO advertisers (id, name, kind, contact, note, created_at, updated_at) VALUES
  ('house', 'Ads-manager 自家', 'house', NULL, '自家產品與友好合作方', 0, 0);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('serve_cache_ttl_seconds', '0', 0),
  ('daily_impression_cap_default', '0', 0),
  ('asset_token_ttl_seconds', '600', 0),
  ('targeting_timezone', 'Asia/Taipei', 0),
  ('cpm_floor_twd', '30', 0),                         -- CPM 最低值（TWD/1000 次曝光）
  ('ga4_property_javis', 'G-J8X3V9GXR4', 0),          -- API secret 放 /srv/ads/.env，不進 DB
  ('ga4_property_javid', '', 0);
