import { NextResponse } from "next/server";
import { SESSION_COOKIE, destroySession, sessionCookie, userFromToken } from "@/lib/auth.ts";
import { audit } from "@/lib/audit.ts";
import { readCookie, sameOrigin, seeOther } from "@/lib/http.ts";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });
  const token = readCookie(req, SESSION_COOKIE);
  const user = userFromToken(token);
  if (user) audit(user.username, "logout", "user", user.id);
  destroySession(token);
  const res = seeOther("/admin/login");
  res.headers.append("set-cookie", sessionCookie("", 0));
  return res;
}
