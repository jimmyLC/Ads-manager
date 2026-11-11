import { NextResponse } from "next/server";
import { login, sessionCookie } from "@/lib/auth.ts";
import { audit } from "@/lib/audit.ts";
import { readBody, sameOrigin, seeOther } from "@/lib/http.ts";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });
  const { username = "", password = "" } = await readBody(req);
  const result = await login(username, password);
  if (!result) {
    audit(username || "?", "login_failed", "user", username || "?");
    return seeOther("/admin/login?error=1");
  }
  audit(result.user.username, "login", "user", result.user.id);
  const res = seeOther("/admin");
  res.headers.append("set-cookie", sessionCookie(result.token));
  return res;
}
