import { NextResponse } from "next/server";
import { login, sessionCookie } from "@/lib/auth.ts";
import { audit } from "@/lib/audit.ts";
import { readBody, sameOrigin } from "@/lib/http.ts";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });
  const { username = "", password = "" } = await readBody(req);
  const result = await login(username, password);
  if (!result) {
    audit(username || "?", "login_failed", "user", username || "?");
    return NextResponse.redirect(new URL("/admin/login?error=1", req.url), 303);
  }
  audit(result.user.username, "login", "user", result.user.id);
  const res = NextResponse.redirect(new URL("/admin", req.url), 303);
  res.headers.append("set-cookie", sessionCookie(result.token));
  return res;
}
