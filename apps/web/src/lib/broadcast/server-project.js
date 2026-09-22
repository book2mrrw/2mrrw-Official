import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";

function checked(result) { if (result.error) throw new Error("Project lookup unavailable", { cause: result.error }); return result.data; }
const TYPES = new Set(["single", "feature", "album", "mixtape", "ep"]);

/** Reuses both existing canonical identity paths. Never uploads or copies music. */
export async function resolveBroadcastProject({ releaseId, productId }, client = getAdminClient()) {
  if (releaseId) {
    const release = checked(await client.from("releases").select("id,release_type,status,content_kind").eq("id", releaseId).maybeSingle());
    if (!release || (release.content_kind && release.content_kind !== "music") || !TYPES.has(release.release_type) || !["published", "scheduled", "unrelzd"].includes(release.status)) return null;
    const tracks = checked(await client.from("tracks").select("id,title,position,duration_seconds")
      .eq("release_id", releaseId).order("position", { ascending: true }).limit(201));
    return { releaseId, productId: null, items: tracks.map((track) => ({ trackId: track.id, title: track.title,
      durationSeconds: track.duration_seconds, prepared: false })) };
  }
  const product = checked(await client.from("products").select("id,title,release_id,product_type,release_type,active,content_kind")
    .eq("id", productId).maybeSingle());
  if (!product?.active || (product.content_kind && product.content_kind !== "music") || !TYPES.has(product.release_type || product.product_type)) return null;
  // A wizard product resolves to its original release/tracks, never a new copy.
  if (product.release_id) return resolveBroadcastProject({ releaseId: product.release_id }, client);
  const tracks = checked(await client.from("catalog_tracks").select("id,track_id,title,position")
    .eq("product_id", productId).order("position", { ascending: true }).limit(201));
  return { releaseId: null, productId, items: tracks.length ? tracks.map((track) => ({
    trackId: track.track_id, catalogTrackId: track.id, title: track.title, prepared: false,
  })) : ["single", "feature"].includes(product.release_type || product.product_type)
    ? [{ productId, title: product.title, prepared: false }] : [] };
}
