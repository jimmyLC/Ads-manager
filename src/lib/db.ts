import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DB_PATH = process.env.ADS_DB_PATH ?? resolve(process.cwd(), "data/ads.db");
const MIGRATIONS_DIR = resolve(process.cwd(), "db/migrations");

export function openDb(path: string = DB_PATH): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

/** 依檔名順序套用尚未執行的 migration，回傳本次套用的檔名。 */
export function migrate(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(join(dir, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(file, now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    applied.push(file);
  }
  return applied;
}

export const now = () => Math.floor(Date.now() / 1000);

const g = globalThis as unknown as { __adsDb?: DatabaseSync };

/** 服務內共用的單一連線（首次取用時自動 migrate）。 */
export function getDb(): DatabaseSync {
  if (!g.__adsDb) {
    const db = openDb();
    migrate(db);
    g.__adsDb = db;
  }
  return g.__adsDb;
}
