// 週報：npm run report:weekly [-- --out <dir>]
// 產出上一個完整週（週一至週日，UTC）的 CSV 與文字摘要到 outbox 目錄。
// 寄信尚未接上（待決定寄信管道），先輸出檔案；寄送端把 summary.txt 當內文、weekly.csv 當附件即可。
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDb, migrate } from "../src/lib/db.ts";
import { lastFullWeek } from "../src/lib/maint.ts";
import { BOM, csvHeader, csvLine } from "../src/lib/csv.ts";
import { iterateStats, runStats } from "../src/lib/stats.ts";

migrate(openDb());
const i = process.argv.indexOf("--out");
const outDir = resolve(i > 0 ? process.argv[i + 1] : "data/outbox");
const { from, to } = lastFullWeek();
const q = { from, to, groupBy: ["day", "campaign", "placement", "country", "device"] };

mkdirSync(outDir, { recursive: true });
let csv = BOM + csvHeader();
for (const r of iterateStats(q)) csv += csvLine(r);
const csvPath = join(outDir, `ads-report_${from}_${to}_weekly.csv`);
writeFileSync(csvPath, csv);

const pct = (x) => (x * 100).toFixed(2) + "%";
const lines = [`Ads-manager 週報 ${from} ～ ${to}（UTC）`, ""];
for (const r of runStats({ from, to, groupBy: ["campaign"] })) {
  lines.push(`${r.campaign_name}｜曝光 ${r.impressions}　點擊 ${r.clicks}　CTR ${pct(r.ctr)}　轉換 ${r.conversions}　價值 ${r.value} ${r.currency}`);
}
const t = runStats({ from, to, groupBy: [] })[0];
lines.push("", `合計｜曝光 ${t.impressions}　點擊 ${t.clicks}　CTR ${pct(t.ctr)}　轉換 ${t.conversions}　價值 ${t.value} ${t.currency}`, "", `附件：${csvPath}`);
writeFileSync(join(outDir, `ads-report_${from}_${to}_summary.txt`), lines.join("\n") + "\n");
console.log(lines.join("\n"));
