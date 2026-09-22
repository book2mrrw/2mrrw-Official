import "server-only";
import { releaseStorageScope } from "@/lib/storage/storage-scope";
import { getR2ObjectMetadata } from "@/lib/storage/r2";
import { resolvePlaybackKey } from "@/lib/playback/resolve-playback-key";

function checked({ data, error }) { if (error) throw new Error("Media lookup unavailable", { cause: error }); return data; }

/** Every media lookup revalidates the canonical relation; session JSON never supplies object keys. */
export async function resolveBroadcastMedia(client, session, item) {
  let key;
  let storageScope = "public";
  if (session.releaseId) {
    const release = checked(await client.from("releases").select("*").eq("id", session.releaseId).maybeSingle());
    if (!release || ["archived", "withdrawn"].includes(release.status)) return null;
    storageScope = releaseStorageScope(release);
    const track = checked(await client.from("tracks").select("*").eq("id", item.trackId).eq("release_id", session.releaseId).maybeSingle());
    if (!track || track.upload_status !== "ready") return null;
    if (track.storage_scope && track.storage_scope !== storageScope) throw new Error("Canonical media storage mismatch");
    key = track.master_r2_key || track.audio_r2_key;
  } else if (session.productId) {
    const product = checked(await client.from("products").select("id,slug,active,release_id").eq("id", session.productId).maybeSingle());
    if (!product?.active || product.release_id) return null;
    let trackSlug;
    if (item.catalogTrackId) {
      const track = checked(await client.from("catalog_tracks").select("id,slug").eq("id", item.catalogTrackId).eq("product_id", product.id).maybeSingle());
      if (!track) return null;
      trackSlug = track.slug;
    } else if (item.productId !== product.id) return null;
    key = (await resolvePlaybackKey(client, product.slug, { trackSlug }))?.key;
  }
  if (!key) return null;
  const metadata = await getR2ObjectMetadata(key, { storageScope });
  if (!metadata?.contentLength) return null;
  // MIME/container alone does not establish the original codec or lossless provenance.
  return { key, storageScope, contentType: metadata.contentType, qualityLabel: "Original audio" };
}
