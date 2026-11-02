import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ADS_DB_PATH = join(mkdtempSync(join(tmpdir(), "ads-")), "t.db");
const { getDb } = await import("../src/lib/db.ts");
const { createCampaign, setStatus } = await import("../src/lib/campaigns.ts");
const { hashPassword, verifyPassword } = await import("../src/lib/password.ts");

test("seed: 2 placements, house advertiser, 2 draft Viduck campaigns", () => {
  const db = getDb();
  assert.equal(db.prepare("SELECT count(*) n FROM placements").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM campaigns WHERE status='draft' AND name LIKE 'Viduck%'").get().n, 2);
});

test("CPM below floor is rejected, default is the floor", () => {
  assert.deepEqual(createCampaign({ name: "x", placement_ids: ["javis:watch-below"], weight: 1, revenue: 29 }, "t"), { ok: false, reason: "revenue_below_floor" });
  const r = createCampaign({ name: "ok", placement_ids: ["javis:watch-below"], weight: 99 }, "t");
  assert.ok(r.ok);
  const row = getDb().prepare("SELECT weight, revenue FROM campaigns WHERE id=?").get(r.value);
  assert.equal(row.weight, 10);
  assert.equal(row.revenue, 30);
});

test("status transitions are audited and validated", () => {
  const before = getDb().prepare("SELECT count(*) n FROM audit_log").get().n;
  assert.ok(setStatus("cp_viduck_javis", "active", "t").ok);
  assert.equal(setStatus("cp_viduck_javis", "active", "t").ok, false);
  assert.ok(setStatus("cp_viduck_javis", "paused", "t").ok);
  assert.equal(getDb().prepare("SELECT count(*) n FROM audit_log").get().n, before + 2);
});

test("scrypt hash verifies and rejects", async () => {
  const h = await hashPassword("correct horse battery");
  assert.ok(await verifyPassword("correct horse battery", h));
  assert.equal(await verifyPassword("wrong", h), false);
});
