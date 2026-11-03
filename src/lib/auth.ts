import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb, now } from "./db.ts";
import { verifyPassword, hashPassword } from "./password.ts";

export const SESSION_COOKIE = "ads_session";
const SESSION_TTL = 8 * 3600;

export type Role = "admin" | "viewer";
export interface SessionUser { id: string; username: string; role: Role }

// 以 session id 的雜湊存庫，DB 外洩也無法直接盜用 cookie
const sid = (token: string) => createHash("sha256").update(token).digest("hex");

// 站內限流（記憶體、不存 IP）：同一帳號 15 分鐘內最多 5 次失敗
const fails = new Map<string, number[]>();
const WINDOW = 15 * 60_000, MAX_FAILS = 5;
const DUMMY_HASH = "16384$8$1$00000000000000000000000000000000$" + "00".repeat(64);

function tooMany(username: string): boolean {
  const recent = (fails.get(username) ?? []).filter((t) => Date.now() - t < WINDOW);
  fails.set(username, recent);
  return recent.length >= MAX_FAILS;
}

export async function login(username: string, password: string): Promise<{ token: string; user: SessionUser } | null> {
  const db = getDb();
  if (tooMany(username)) return null;
  const row = db.prepare("SELECT id, username, password_hash, role, disabled FROM users WHERE username = ?").get(username) as
    | { id: string; username: string; password_hash: string; role: Role; disabled: number }
    | undefined;
  // 查無帳號也跑一次 scrypt，避免從耗時差判斷帳號是否存在
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || row.disabled) {
    fails.set(username, [...(fails.get(username) ?? []), Date.now()]);
    await new Promise((r) => setTimeout(r, 500));
    return null;
  }
  fails.delete(username);
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    sid(token), row.id, now(), now() + SESSION_TTL,
  );
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now(), row.id);
  return { token, user: { id: row.id, username: row.username, role: row.role } };
}

export function userFromToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`,
    )
    .get(sid(token), now()) as unknown as SessionUser | undefined;
  return row ?? null;
}

export function destroySession(token: string | undefined) {
  if (token) getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sid(token));
}

export async function currentUser(): Promise<SessionUser | null> {
  return userFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export const sessionCookie = (token: string, maxAge = SESSION_TTL) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` +
  (process.env.ADS_INSECURE_COOKIE ? "" : "; Secure");

export { hashPassword };
