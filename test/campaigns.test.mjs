import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ads-"));
process.env.ADS_DB_PATH = join(dir, "t.db");
process.env.ADS_ASSET_DIR = join(dir, "assets");
process.env.APP_SECRET = "test-secret";
const { getDb } = await import("../src/lib/db.ts");
const { createCampaign, setStatus } = await import("../src/lib/campaigns.ts");
const { createCreative } = await import("../src/lib/creatives.ts");
const { storeAsset } = await import("../src/lib/assets.ts");
const { serve, localParts } = await import("../src/lib/serve.ts");
const { signAssetToken, verifyAssetToken } = await import("../src/lib/secret.ts");
const { hashPassword, verifyPassword } = await import("../src/lib/password.ts");
const { png } = await import("./helpers.mjs");

const db = getDb();
const SPEC = { desktop: [1280, 400], "desktop@2x": [2560, 800], mobile: [640, 200], "mobile@2x": [1280, 400] };

function readyCampaign(id, placement) {
  const cr = createCreative({ campaign_id: id, kind: "image", name: "A", alt_text: "alt", cta_url: "https://example.com/x" }, "t", "admin");
  assert.ok(cr.ok, JSON.stringify(cr));
  for (const v of ["desktop", "mobile"]) assert.ok(storeAsset(cr.value, placement, v, png(...SPEC[v]), "t").ok);
  return cr.value;
}

test("seed: 2 placements, house advertiser, 2 draft Viduck campaigns", () => {
  assert.equal(db.prepare("SELECT count(*) n FROM placements").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM campaigns WHERE status='draft' AND name LIKE 'Viduck%'").get().n, 2);
});

test("CPM below floor is rejected, default is the floor", () => {
  assert.deepEqual(createCampaign({ name: "x", placement_ids: ["javis:watch-below"], weight: 1, revenue: 29 }, "t"), { ok: false, reason: "revenue_below_floor" });
  const r = createCampaign({ name: "ok", placement_ids: ["javis:watch-below"], weight: 99 }, "t");
  assert.ok(r.ok);
  const row = db.prepare("SELECT weight, revenue FROM campaigns WHERE id=?").get(r.value);
  assert.equal(row.weight, 10);
  assert.equal(row.revenue, 30);
});

test("upload validation: dimensions, @2x, kind, unreadable, size", () => {
  const cr = createCreative({ campaign_id: "cp_viduck_javis", kind: "image", name: "V", alt_text: "a", cta_url: "https://example.com" }, "t", "admin").value;
  const up = (v, buf, pl = "javis:watch-below") => storeAsset(cr, pl, v, buf, "t");
  assert.match(up("desktop", png(970, 250)).reason, /bad_dimensions_expected_1280x400/);
  assert.match(up("desktop", png(1280, 400) /* ok */).ok ? "x" : "y", /x/);
  assert.match(up("mobile@2x", png(640, 200)).reason, /bad_dimensions_expected_1280x400/);
  assert.ok(up("mobile@2x", png(1280, 400)).ok);
  assert.equal(up("desktop", Buffer.from("not an image")).reason, "unreadable_image");
  assert.equal(up("desktop", Buffer.alloc(600 * 1024, 1)).reason, "file_too_large");
  assert.equal(up("logo", png(100, 100)).reason, "variant_not_allowed_for_kind");
  assert.equal(up("desktop", png(1280, 400), "javid:result-foot").reason, "placement_not_bound_to_campaign");
});

test("publish needs ready creative; transitions are audited", () => {
  assert.equal(setStatus("cp_viduck_javis", "active", "t").reason, "no_ready_creative");
  const cr = db.prepare("SELECT id FROM creatives WHERE campaign_id='cp_viduck_javis'").get().id;
  assert.ok(storeAsset(cr, "javis:watch-below", "desktop", png(1280, 400), "t").ok);
  assert.ok(storeAsset(cr, "javis:watch-below", "mobile", png(640, 200), "t").ok);
  const before = db.prepare("SELECT count(*) n FROM audit_log").get().n;
  assert.ok(setStatus("cp_viduck_javis", "active", "t").ok);
  assert.equal(setStatus("cp_viduck_javis", "active", "t").ok, false);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_log").get().n, before + 1);
});

test("serve: returns ad, counts impression, unknown placement 404", () => {
  const r = serve({ site: "javis", slot: "watch-below", country: "tw", device: "mobile" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.ad.aspect, "16/5");
  assert.match(r.body.ad.image.desktop.url, /^\/api\/promo\/img\/as_\w+\?d=desktop&t=\d+\./);
  assert.equal(db.prepare("SELECT impressions n FROM ad_counters WHERE country='TW' AND device='mobile'").get().n, 1);
  assert.equal(serve({ site: "javis", slot: "nope" }).status, 404);
  assert.equal(serve({ site: "javid", slot: "result-foot" }).body.reason, "no_eligible_ad");
});

test("targeting: country in / XX excluded / not_in / hour / weekday (Asia/Taipei)", () => {
  const rule = (d, o, v) => db.prepare("INSERT INTO targeting_rules (id, campaign_id, dimension, operator, value, created_at, updated_at) VALUES (?,?,?,?,?,0,0)").run("tg" + Math.random(), "cp_viduck_javis", d, o, v);
  const ok = (o) => serve({ site: "javis", slot: "watch-below", country: "TW", device: "desktop" }, o).body.ok;
  db.prepare("DELETE FROM targeting_rules").run();
  rule("country", "in", "TW,JP");
  assert.equal(ok(), true);
  assert.equal(serve({ site: "javis", slot: "watch-below", country: "US" }).body.ok, false);
  assert.equal(serve({ site: "javis", slot: "watch-below" }).body.ok, false, "XX must not match country rule");
  db.prepare("DELETE FROM targeting_rules").run();
  rule("device", "not_in", "mobile");
  assert.equal(serve({ site: "javis", slot: "watch-below", device: "mobile" }).body.ok, false);
  assert.equal(ok(), true);
  db.prepare("DELETE FROM targeting_rules").run();
  const t = new Date("2026-11-02T16:30:00Z"); // 台北 2026-11-03 00:30，週二
  assert.deepEqual(localParts(t, "Asia/Taipei"), { hour: 0, weekday: 2 });
  rule("hour", "in", "0");
  rule("weekday", "equals", "2");
  assert.equal(ok({ now: t }), true);
  assert.equal(ok({ now: new Date("2026-11-02T17:30:00Z") }), false);
  db.prepare("DELETE FROM targeting_rules").run();
});

test("limits: schedule window, daily cap, click target", () => {
  const set = (sql, ...a) => db.prepare(sql).run(...a);
  const ok = (o) => serve({ site: "javis", slot: "watch-below", country: "TW" }, o).body.ok;
  set("UPDATE campaigns SET ends_at = 1 WHERE id='cp_viduck_javis'");
  assert.equal(ok(), false);
  set("UPDATE campaigns SET ends_at = NULL, starts_at = ? WHERE id='cp_viduck_javis'", Math.floor(Date.now() / 1000) + 3600);
  assert.equal(ok(), false);
  set("UPDATE campaigns SET starts_at = NULL WHERE id='cp_viduck_javis'");
  assert.equal(ok(), true);
  const imp = db.prepare("SELECT COALESCE(SUM(impressions),0) n FROM ad_counters WHERE campaign_id='cp_viduck_javis'").get().n;
  set("UPDATE campaigns SET daily_impression_cap = ? WHERE id='cp_viduck_javis'", imp);
  assert.equal(ok(), false);
  set("UPDATE campaigns SET daily_impression_cap = NULL, target_click = 1 WHERE id='cp_viduck_javis'");
  assert.equal(ok(), true);
  set("UPDATE ad_counters SET clicks = 1 WHERE campaign_id='cp_viduck_javis'");
  assert.equal(ok(), false);
  set("UPDATE campaigns SET target_click = NULL WHERE id='cp_viduck_javis'");
});

test("weighted pick follows rng", () => {
  const c = createCampaign({ name: "B", placement_ids: ["javis:watch-below"], weight: 10 }, "t").value;
  readyCampaign(c, "javis:watch-below");
  assert.ok(setStatus(c, "active", "t").ok);
  db.prepare("UPDATE campaigns SET weight = 1 WHERE id='cp_viduck_javis'").run();
  const who = (rng) => serve({ site: "javis", slot: "watch-below" }, { rng }).body.ad.campaign_id;
  assert.equal(who(() => 0.99), c);          // 落在權重 10 的區間
  assert.equal(who(() => 0.01), "cp_viduck_javis"); // 落在權重 1 的區間
});

test("asset token: valid, tampered, expired", () => {
  const t = signAssetToken("as_1", 600, 1000);
  assert.ok(verifyAssetToken("as_1", t, 1100));
  assert.equal(verifyAssetToken("as_2", t, 1100), false);
  assert.equal(verifyAssetToken("as_1", t, 2000), false);
  assert.equal(verifyAssetToken("as_1", t.replace(/.$/, "x"), 1100), false);
  assert.equal(verifyAssetToken("as_1", null, 1100), false);
});

test("scrypt hash verifies and rejects", async () => {
  const h = await hashPassword("correct horse battery");
  assert.ok(await verifyPassword("correct horse battery", h));
  assert.equal(await verifyPassword("wrong", h), false);
});
