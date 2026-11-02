import { getDb, now } from "./db.ts";

export function audit(actor: string, action: string, objectType: string, objectId: string, detail?: unknown) {
  getDb()
    .prepare("INSERT INTO audit_log (ts, actor, action, object_type, object_id, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .run(now(), actor, action, objectType, objectId, detail === undefined ? null : JSON.stringify(detail));
}
