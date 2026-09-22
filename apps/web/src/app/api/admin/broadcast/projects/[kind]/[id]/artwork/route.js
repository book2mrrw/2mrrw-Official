import { authorizeBroadcastAdmin, broadcastResponse as response } from "@/lib/broadcast/admin-http";
import { getAdminClient } from "@/lib/supabase/admin";
import { projectCard } from "@/lib/broadcast/project-catalog";
import { releaseStorageScope } from "@/lib/storage/storage-scope";
import { createR2SignedGetUrl, discoverFileByExtensions } from "@/lib/storage/r2";
import { proxySignedR2Get } from "@/lib/server/r2-stream-proxy";

export const dynamic = "force-dynamic";
export async function GET(req, context) {
  try {
    const access = await authorizeBroadcastAdmin(req, context);
    if (access.denial) return access.denial;
    const { kind } = await context.params;
    if (!["release", "product"].includes(kind)) return response({ error: "Not found" }, 404);
    const { data: row, error } = await getAdminClient().from(kind === "release" ? "releases" : "products").select("*").eq("id", access.id).maybeSingle();
    if (error) throw error;
    if (!row || !projectCard(row, kind, 0)) return response({ error: "Not found" }, 404);
    const storageScope = kind === "release" ? releaseStorageScope(row) : "public";
    const key = kind === "release" ? row.cover_art_r2_key : row.image_path
      ? await discoverFileByExtensions(String(row.image_path).replace(/\/$/, ""), [".jpg", ".jpeg", ".png", ".webp"]) : null;
    if (!key) return response({ error: "Artwork unavailable" }, 404);
    const signed = await createR2SignedGetUrl(key, 60, { storageScope });
    return proxySignedR2Get(req, signed, { cacheControl: "private, no-store", opaqueErrors: true });
  } catch { return response({ error: "Artwork unavailable" }, 503); }
}
