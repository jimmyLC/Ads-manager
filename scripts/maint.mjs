// 每日維護（ads-maint.timer 04:40 UTC 觸發）：npm run maint
import { openDb, migrate } from "../src/lib/db.ts";
import { dailyMaintenance } from "../src/lib/maint.ts";

migrate(openDb());
const r = dailyMaintenance();
console.log(`已結束活動：${r.ended.length ? r.ended.join(", ") : "無"}；清除過期 session：${r.sessionsDeleted}`);
