import { readAsset } from "@/lib/assets.ts";
import { verifyAssetToken } from "@/lib/secret.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!verifyAssetToken(id, new URL(req.url).searchParams.get("t"))) return new Response("forbidden", { status: 403 });
  const a = readAsset(id);
  if (!a) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(a.bytes), {
    headers: { "content-type": a.contentType, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" },
  });
}
