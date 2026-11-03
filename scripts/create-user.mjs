// 用法：npm run user:create -- <username> [admin|viewer]
// 密碼以隱藏輸入詢問，不經命令列參數，避免留在 shell history。
import { openDb, migrate, now } from "../src/lib/db.ts";
import { hashPassword } from "../src/lib/password.ts";
import { randomUUID } from "node:crypto";

const [username, role = "viewer"] = process.argv.slice(2);
if (!username || !["admin", "viewer"].includes(role)) {
  console.error("用法：npm run user:create -- <username> [admin|viewer]");
  process.exit(1);
}

function ask(prompt) {
  return new Promise((ok) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    stdin.on("data", function onData(ch) {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return ok(buf);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") buf = buf.slice(0, -1);
        else buf += c;
      }
    });
  });
}

const pw = process.env.ADS_NEW_PASSWORD ?? (await ask("密碼（至少 12 字元）："));
if (pw.length < 12) {
  console.error("密碼太短");
  process.exit(1);
}
if (!process.env.ADS_NEW_PASSWORD && (await ask("再輸入一次：")) !== pw) {
  console.error("兩次不一致");
  process.exit(1);
}

const db = openDb();
migrate(db);
const t = now();
db.prepare(
  "INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
).run(randomUUID(), username, await hashPassword(pw), role, t, t);
db.prepare("INSERT INTO audit_log (ts, actor, action, object_type, object_id) VALUES (?, 'cli', 'create', 'user', ?)").run(t, username);
console.log(`已建立 ${role} 帳號：${username}`);
