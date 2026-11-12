import { test } from "node:test";
import assert from "node:assert/strict";
import { presetRange, readRange } from "../src/lib/range.ts";

const now = new Date("2026-03-10T05:00:00Z");

test("range: presets use UTC days", () => {
  assert.deepEqual(presetRange("today", now), { from: "2026-03-10", to: "2026-03-10" });
  assert.deepEqual(presetRange("last_7d", now), { from: "2026-03-04", to: "2026-03-10" });
  assert.deepEqual(presetRange("this_month", now), { from: "2026-03-01", to: "2026-03-10" });
  assert.deepEqual(presetRange("last_month", now), { from: "2026-02-01", to: "2026-02-28" });
});

test("range: custom from/to wins, bad input falls back to last 7 days", () => {
  assert.equal(readRange({ from: "2026-01-01", to: "2026-01-31" }).preset, "custom");
  assert.equal(readRange({ from: "2026-02-01", to: "2026-01-01" }).preset, "last_7d");
  assert.equal(readRange({ range: "nope" }).preset, "last_7d");
  assert.equal(readRange({ range: "yesterday" }).label, "昨天");
});
