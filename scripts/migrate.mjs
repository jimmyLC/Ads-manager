import { openDb, migrate, DB_PATH } from "../src/lib/db.ts";

const db = openDb();
const applied = migrate(db);
console.log(`DB: ${DB_PATH}`);
console.log(applied.length ? `已套用：${applied.join(", ")}` : "已是最新");
