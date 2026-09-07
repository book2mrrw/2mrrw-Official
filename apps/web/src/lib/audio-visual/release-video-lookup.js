/**
 * Bulk "does this release have a music video" resolution — the join
 * catalog-db.js needs to enrich release cards platform-wide with a video
 * link, without an N+1 query per card. Deliberately reads only the direct
 * `audio_visuals.release_id` column (set explicitly by the admin when
 * linking a video to a release, see InlineAudioVisualzManager.js's
 * TrackPicker) rather than also resolving through track_id — a multi-track
 * release (album/EP) has no single correct "the" video to point a release
 * card at, so only an explicit release-level link surfaces the icon.
 *
 * Never imports anything from the release/track upload pipeline itself —
 * only reads audio_visuals, this feature's own table.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicR2Url } from "@/lib/storage/r2";

const PUBLISHED_STATES = ["ready", "published"];

/**
 * @param {string[]} releaseIds
 * @param {object} [admin] - optional Supabase service client to reuse
 * @returns {Promise<Map<string, { id: string, poster_url: string|null }>>}
 *   keyed by release_id
 */
export async function getMusicVideosForReleaseIds(releaseIds, admin = null) {
  const ids = [...new Set((releaseIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const client = admin || getAdminClient();
  const { data, error } = await client
    .from("audio_visuals")
    .select("id, release_id, poster_r2_key")
    .in("release_id", ids)
    .eq("video_type", "music_video")
    .in("publication_state", PUBLISHED_STATES);

  if (error) {
    console.error("[release-video-lookup] fetch error", error.message);
    return new Map();
  }

  const byReleaseId = new Map();
  for (const row of data || []) {
    if (!row.release_id || byReleaseId.has(row.release_id)) continue;
    byReleaseId.set(row.release_id, {
      id: row.id,
      poster_url: row.poster_r2_key ? getPublicR2Url(row.poster_r2_key) : null,
    });
  }
  return byReleaseId;
}
