import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, fail) =>
    scrypt(password, salt, KEYLEN, { N: n, r, p }, (e, key) => (e ? fail(e) : ok(key))),
  );
}

/** 格式：N$r$p$salt(hex)$hash(hex)，對應 schema 的 users.password_hash。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return [N, R, P, salt.toString("hex"), key.toString("hex")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [n, r, p, saltHex, hashHex] = stored.split("$");
  if (!hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const key = await derive(password, Buffer.from(saltHex, "hex"), +n, +r, +p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}
