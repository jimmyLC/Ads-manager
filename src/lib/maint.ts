import { getDb, now } from "./db.ts";
import { utcDay } from "./serve.ts";

/** 把已到期或已達目標的活動標成 ended（serve 本來就不會投，這裡讓後台狀態與事實一致）。 */
export function endFinishedCampaigns(): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.id, c.ends_at, c.target_impression, c.target_click,
            COALESCE((SELECT SUM(impressions) FROM ad_counters WHERE campaign_id = c.id), 0) AS imp,
            COALESCE((SELECT SUM(clicks) FROM ad_counters WHERE campaign_id = c.id), 0) AS clk
     FROM campaigns c WHERE c.status IN ('active', 'paused')`,
  ).all() as { id: string; ends_at: number | null; target_impression: number | null; target_click: number | null; imp: number; clk: number }[];
  const ended: string[] = [];
  for (const r of rows) {
    const reason = r.ends_at != null && r.ends_at < now() ? "expired"
      : r.target_impression != null && r.imp >= r.target_impression ? "target_impression"
      : r.target_click != null && r.clk >= r.target_click ? "target_click" : null;
    if (!reason) continue;
    db.prepare("UPDATE campaigns SET status = 'ended', updated_at = ?, updated_by = 'maint' WHERE id = ?").run(now(), r.id);
    db.prepare("INSERT INTO audit_log (ts, actor, action, object_type, object_id, detail) VALUES (?, 'maint', 'end', 'campaign', ?, ?)")
      .run(now(), r.id, JSON.stringify({ reason }));
    ended.push(r.id);
  }
  return ended;
}

/** 每日維護：清過期 session、清 30 天前的 ip_hash、WAL checkpoint。 */
export function dailyMaintenance(): { ended: string[]; sessionsDeleted: number } {
  const db = getDb();
  const ended = endFinishedCampaigns();
  const sessionsDeleted = Number(db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now()).changes);
  db.prepare("UPDATE sessions SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?").run(now() - 30 * 86400);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return { ended, sessionsDeleted };
}

/** 上一個完整週（週一至週日，UTC）。 */
export function lastFullWeek(ref = new Date()): { from: string; to: string } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // 週一=0
  const thisMon = new Date(d.getTime() - dow * 86400_000);
  return { from: utcDay(new Date(thisMon.getTime() - 7 * 86400_000)), to: utcDay(new Date(thisMon.getTime() - 86400_000)) };
}
