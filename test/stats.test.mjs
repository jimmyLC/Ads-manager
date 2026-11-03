import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ADS_DB_PATH = join(mkdtempSync(join(tmpdir(), "ads-")), "t.db");
const { getDb } = await import("../src/lib/db.ts");
const { parseQuery, runStats, totals, countStats, iterateStats } = await import("../src/lib/stats.ts");
const { cell, csvHeader, csvLine } = await import("../src/lib/csv.ts");
const { endFinishedCampaigns, lastFullWeek } = await import("../src/lib/maint.ts");

const db = getDb();
const put = (day, camp, cr, pl, country, device, i, k, c) =>
  db.prepare("INSERT INTO ad_counters VALUES (?,?,?,?,?,?,?,?,?)").run(day, camp, cr, pl, country, device, i, k, c);
db.prepare("INSERT INTO creatives (id,campaign_id,kind,name,created_at,updated_at) VALUES ('cr_a','cp_viduck_javis','image','=SUM(A1)',0,0)").run();
put("2026-11-01", "cp_viduck_javis", "cr_a", "javis:watch-below", "TW", "desktop", 1000, 20, 2);
put("2026-11-01", "cp_viduck_javis", "cr_a", "javis:watch-below", "JP", "mobile", 500, 5, 0);
put("2026-11-02", "cp_viduck_javis", "cr_a", "javis:watch-below", "TW", "mobile", 500, 0, 0);
put("2026-11-01", "cp_viduck_javid", "cr_b", "javid:result-foot", "TW", "desktop", 2000, 10, 1);
put("2026-11-05", "cp_viduck_javis", "cr_a", "javis:watch-below", "TW", "desktop", 999, 9, 9); // 範圍外
const Q = { from: "2026-11-01", to: "2026-11-03", groupBy: [] };

test("query parsing validates dates and groupBy whitelist", () => {
  const p = (s) => parseQuery(new URLSearchParams(s));
  assert.equal(p("from=2026-11-01&to=2026-11-03").ok, true);
  assert.equal(p("from=2026-11-01").reason, "bad_date");
  assert.equal(p("from=2026-11-04&to=2026-11-03").reason, "bad_date_range");
  assert.equal(p("from=2026-11-01&to=2026-11-03&groupBy=day;drop").reason, "bad_group_by");
});

test("totals: CPM value = 30/1000 × impressions, eCPM = 30, ctr/cvr", () => {
  const t = totals(Q);
  assert.equal(t.impressions, 4000);
  assert.equal(t.clicks, 35);
  assert.equal(t.conversions, 3);
  assert.equal(t.value, 120); // 4000 × 30 / 1000
  assert.equal(t.ecpm, 30);
  assert.equal(t.ctr, 0.0088); // 35/4000 = 0.00875 → 4 位
  assert.equal(t.cvr, round(3 / 35));
  assert.equal(t.currency, "TWD");
});
const round = (x) => Math.round(x * 10000) / 10000;

test("groupBy site separates javis/javid; cross-site total equals sum", () => {
  const rows = runStats({ ...Q, groupBy: ["site"] });
  assert.deepEqual(rows.map((r) => [r.site, r.impressions]), [["javid", 2000], ["javis", 2000]]);
});

test("groupBy day×device and filters", () => {
  const rows = runStats({ ...Q, groupBy: ["day", "device"], site: "javis" });
  assert.deepEqual(rows.map((r) => `${r.day}/${r.device}/${r.impressions}`), ["2026-11-01/desktop/1000", "2026-11-01/mobile/500", "2026-11-02/mobile/500"]);
  assert.equal(totals({ ...Q, country: "JP" }).impressions, 500);
  assert.equal(totals({ ...Q, placement_id: "javid:result-foot" }).clicks, 10);
});

test("cpc / cpa campaigns use their own formula", () => {
  db.prepare("UPDATE campaigns SET revenue_type='cpc', revenue=50 WHERE id='cp_viduck_javid'").run();
  assert.equal(runStats({ ...Q, groupBy: ["campaign"] }).find((r) => r.campaign_id === "cp_viduck_javid").value, 500); // 10 點擊 × 50
  db.prepare("UPDATE campaigns SET revenue_type='cpm', revenue=30 WHERE id='cp_viduck_javid'").run();
});

test("count, iterate and CSV safety", () => {
  const q = { ...Q, groupBy: ["day", "creative"] };
  assert.equal(countStats(q), [...iterateStats(q)].length);
  const line = csvLine([...iterateStats(q)][0]);
  assert.ok(line.includes("'=SUM(A1)"), "公式注入需加單引號：" + line);
  assert.equal(cell('a,"b"'), '"a,""b"""');
  assert.ok(csvHeader().startsWith("day,site,placement"));
});

test("maintenance ends expired and target-reached campaigns", () => {
  db.prepare("UPDATE campaigns SET status='active', target_impression=2000 WHERE id='cp_viduck_javid'").run();
  db.prepare("UPDATE campaigns SET status='active', ends_at=1 WHERE id='cp_viduck_javis'").run();
  assert.deepEqual(endFinishedCampaigns().sort(), ["cp_viduck_javid", "cp_viduck_javis"]);
  assert.equal(db.prepare("SELECT status FROM campaigns WHERE id='cp_viduck_javid'").get().status, "ended");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE actor='maint'").get().n, 2);
});

test("lastFullWeek is the previous Mon–Sun", () => {
  assert.deepEqual(lastFullWeek(new Date("2026-11-03T10:00:00Z")), { from: "2026-10-26", to: "2026-11-01" }); // 週二
  assert.deepEqual(lastFullWeek(new Date("2026-11-02T00:00:00Z")), { from: "2026-10-26", to: "2026-11-01" }); // 週一
  assert.deepEqual(lastFullWeek(new Date("2026-11-01T23:59:00Z")), { from: "2026-10-19", to: "2026-10-25" }); // 週日
});
