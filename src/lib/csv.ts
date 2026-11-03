import { COLUMNS, type StatsRow } from "./stats.ts";

/** CSV 欄位：加引號跳脫，並擋 Excel 公式注入（= + - @ 開頭的文字前面補單引號）。 */
export function cell(v: string | number): string {
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvHeader = () => COLUMNS.join(",") + "\r\n";
export const csvLine = (r: StatsRow) => COLUMNS.map((c) => cell(r[c])).join(",") + "\r\n";
export const BOM = "﻿";
