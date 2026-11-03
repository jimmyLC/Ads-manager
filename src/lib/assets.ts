import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, now } from "./db.ts";
import { CONTENT_TYPE, probeImage } from "./image.ts";
import type { Result } from "./campaigns.ts";

export const assetDir = () => resolve(process.env.ADS_ASSET_DIR ?? join(process.cwd(), "data/assets"));

export const IMAGE_VARIANTS = ["desktop", "desktop@2x", "mobile", "mobile@2x"] as const;
export const NATIVE_VARIANTS = ["logo", "thumb"] as const;
const MAX_BYTES: Record<string, number> = {
  desktop: 512 * 1024, "desktop@2x": 512 * 1024, mobile: 256 * 1024, "mobile@2x": 256 * 1024,
  logo: 256 * 1024, thumb: 256 * 1024,
};

interface PlacementSpec { id: string; width_desktop: number; height_desktop: number; width_mobile: number; height_mobile: number }

/** 驗證（SPEC §3.3）並存檔，成功回傳 asset id。同一 creative/版位/variant 重傳會取代舊的。 */
export function storeAsset(
  creativeId: string, placementId: string, variant: string, data: Buffer, actor: string,
): Result<string> {
  const db = getDb();
  const cr = db.prepare("SELECT id, kind, campaign_id FROM creatives WHERE id = ?").get(creativeId) as
    | { id: string; kind: string; campaign_id: string } | undefined;
  if (!cr) return { ok: false, reason: "creative_not_found" };
  const imageVariant = (IMAGE_VARIANTS as readonly string[]).includes(variant);
  const nativeVariant = (NATIVE_VARIANTS as readonly string[]).includes(variant);
  if (!(cr.kind === "image" && imageVariant) && !(cr.kind === "native" && nativeVariant))
    return { ok: false, reason: "variant_not_allowed_for_kind" };

  const pl = db.prepare(
    `SELECT p.* FROM placements p JOIN campaign_placements cp ON cp.placement_id = p.id
     WHERE p.id = ? AND cp.campaign_id = ?`,
  ).get(placementId, cr.campaign_id) as unknown as PlacementSpec | undefined;
  if (!pl) return { ok: false, reason: "placement_not_bound_to_campaign" };

  if (data.length > MAX_BYTES[variant]) return { ok: false, reason: "file_too_large" };
  const info = probeImage(data);
  if (!info) return { ok: false, reason: "unreadable_image" };

  if (imageVariant) {
    const mobile = variant.startsWith("mobile");
    const scale = variant.endsWith("@2x") ? 2 : 1;
    const w = (mobile ? pl.width_mobile : pl.width_desktop) * scale;
    const h = (mobile ? pl.height_mobile : pl.height_desktop) * scale;
    if (info.width !== w || info.height !== h) return { ok: false, reason: `bad_dimensions_expected_${w}x${h}` };
  }

  const sha = createHash("sha256").update(data).digest("hex");
  const rel = join(sha.slice(0, 2), `${sha}.${info.type === "jpeg" ? "jpg" : info.type}`);
  mkdirSync(join(assetDir(), sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(assetDir(), rel), data);

  const id = "as_" + randomBytes(5).toString("hex");
  const t = now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM creative_assets WHERE creative_id = ? AND placement_id = ? AND variant = ?").run(creativeId, placementId, variant);
    db.prepare(
      `INSERT INTO creative_assets (id, creative_id, placement_id, variant, width, height, bytes, sha256, path, content_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, creativeId, placementId, variant, info.width, info.height, data.length, sha, rel, CONTENT_TYPE[info.type], t);
    if (nativeVariant)
      db.prepare(`UPDATE creatives SET ${variant}_asset_id = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(id, t, actor, creativeId);
    db.prepare("INSERT INTO audit_log (ts, actor, action, object_type, object_id, detail) VALUES (?, ?, 'upload', 'creative', ?, ?)")
      .run(t, actor, creativeId, JSON.stringify({ asset: id, placement: placementId, variant, bytes: data.length, sha256: sha }));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, value: id };
}

export function readAsset(id: string): { bytes: Buffer; contentType: string } | null {
  const row = getDb().prepare("SELECT path, content_type FROM creative_assets WHERE id = ?").get(id) as
    | { path: string; content_type: string } | undefined;
  if (!row) return null;
  const file = join(assetDir(), row.path);
  return existsSync(file) ? { bytes: readFileSync(file), contentType: row.content_type } : null;
}
