import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

let cached: string | undefined;

/** 正式環境必須提供 APP_SECRET；開發環境自動產生並存在 data/.dev-secret。 */
export function appSecret(): string {
  if (cached) return cached;
  if (process.env.APP_SECRET) return (cached = process.env.APP_SECRET);
  if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET is required in production");
  const file = resolve(process.cwd(), "data/.dev-secret");
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return (cached = readFileSync(file, "utf8").trim());
}

const mac = (assetId: string, exp: number) =>
  createHmac("sha256", appSecret()).update(`${assetId}|${exp}`).digest("base64url");

/** token = <expiry>.<HMAC(assetId|expiry)> */
export function signAssetToken(assetId: string, ttlSeconds: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const exp = nowSec + ttlSeconds;
  return `${exp}.${mac(assetId, exp)}`;
}

export function verifyAssetToken(assetId: string, token: string | null, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const [expStr, sig] = (token ?? "").split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isInteger(exp) || exp < nowSec) return false;
  const a = Buffer.from(sig), b = Buffer.from(mac(assetId, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}
