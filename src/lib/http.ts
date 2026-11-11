import { NextResponse } from "next/server";
import { SESSION_COOKIE, userFromToken, type Role, type SessionUser } from "./auth.ts";

export function readCookie(req: Request, name: string): string | undefined {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m?.[1];
}

/** 改寫類請求必須同源（搭配 SameSite=Strict 防 CSRF）。 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return new URL(origin).host === req.headers.get("host");
}

export async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v == null ? "" : String(v)]));
  }
  const fd = await req.formData().catch(() => null);
  return fd ? Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])) : {};
}

type Guard = { user: SessionUser; res?: undefined } | { user?: undefined; res: NextResponse };

/** 驗證 session、角色與同源；失敗回傳要直接送出的 response。 */
export function guard(req: Request, role: Role = "viewer"): Guard {
  const user = userFromToken(readCookie(req, SESSION_COOKIE));
  if (!user) return { res: NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 }) };
  if (req.method !== "GET" && !sameOrigin(req))
    return { res: NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 }) };
  if (role === "admin" && user.role !== "admin")
    return { res: NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 }) };
  return { user };
}

/** 表單送出走 303 回頁面，JSON 呼叫端回 JSON。 */
export function respond(req: Request, back: string, json: unknown, status = 200): NextResponse {
  if ((req.headers.get("accept") ?? "").includes("application/json") || (req.headers.get("content-type") ?? "").includes("json"))
    return NextResponse.json(json, { status });
  return seeOther(back);
}

/** 303 到站內相對路徑。不用 req.url：在 tunnel 後面它是 127.0.0.1:9090。 */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}
