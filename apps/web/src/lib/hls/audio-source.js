import { headR2ObjectKey, listR2Objects } from "@/lib/storage/r2";
import { normalizePlaybackR2Key } from "@/lib/playback/normalize-r2-key";

import {MASTER_AUDIO_EXTENSION, validateAudioSourceKey} from '@/lib/media/audio-source-key';
export {MASTER_AUDIO_EXTENSION, validateAudioSourceKey};

/** Encoding source authority is deliberately independent of listening caches. */
export async function resolveAudioSource(admin, { slug, trackSlug = null, releaseType, sourceKey = null }) {
  async function verified(value) {
    validateAudioSourceKey(value);
    const key = validateAudioSourceKey(normalizePlaybackR2Key(value));
    if (!await headR2ObjectKey(key)) throw new Error("Original audio object is missing");
    return key;
  }
  if (sourceKey) return verified(sourceKey);
  const { data: product, error } = await admin.from("products")
    .select("id, storage_path, metadata, release_id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  let row = product;
  if (trackSlug) {
    const result = await admin.from("catalog_tracks")
      .select("storage_path, metadata, track_id").eq("album_slug", slug).eq("slug", trackSlug).maybeSingle();
    if (result.error) throw result.error;
    row = result.data;
  }
  // Follow the authoritative uploaded-master pointer where the projection links it.
  if (row?.track_id || (!trackSlug && product?.release_id)) {
    let query = admin.from("tracks").select("master_r2_key, audio_r2_key");
    query = row?.track_id ? query.eq("id", row.track_id) : query.eq("release_id", product.release_id);
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    const pointer = result.data?.master_r2_key || result.data?.audio_r2_key;
    if (pointer) return verified(pointer);
  }
  const pointer = row?.metadata?.master_r2_key || row?.metadata?.audio_key;
  if (pointer) return verified(pointer);
  if (MASTER_AUDIO_EXTENSION.test(row?.storage_path || "")) return verified(row.storage_path);

  let folder = row?.storage_path || `digital-assets/${releaseType}/${slug}/${trackSlug ? `${trackSlug}/` : ""}`;
  folder = normalizePlaybackR2Key(folder);
  if (!folder.endsWith("/")) folder += "/";
  const objects = await listR2Objects(folder, { recursive: false });
  const candidates = [...new Set(objects.map(o => o.Key).filter(key => key?.startsWith(folder) &&
    !key.slice(folder.length).includes("/") && MASTER_AUDIO_EXTENSION.test(key)))];
  if (candidates.length !== 1) throw new Error(candidates.length ?
    "Multiple original audio candidates; an explicit master pointer is required" : "No original audio object found");
  return verified(candidates[0]);
}
