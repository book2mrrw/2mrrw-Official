import { clearPersistedPlaybackKey } from '@/lib/playback/resolve-playback-key';
import { clearMediaResolverCaches } from '@/lib/media/cache-invalidation';
import { resolveAudioSource } from '@/lib/hls/audio-source';
import { submitAudioJob } from '@/lib/hls/submit-audio-job';
import { buildHLSPrefix } from '@/lib/hls/derive-key';

/** Queue a replacement beside the published generation. Existing playlists
 * and bytes remain readable until the fenced worker commits verified output.
 * Failure must leave the current recording playable, including in open tabs.
 */
export async function invalidateAudioCacheAndRequeueTranscode({
  admin, slug, trackSlug = null, releaseType, sourceKey = null, queuedBy = null,
}) {
  if (releaseType === 'eps') releaseType = 'mixtapes-and-eps';
  const steps = { publishedAudioPreserved: true, sourceVerified: false,
    jobQueued: false, cacheInvalidated: false };
  let jobId = null;
  let hlsPrefix = buildHLSPrefix(slug, trackSlug, releaseType);
  try {
    const source = await resolveAudioSource(admin, { slug, trackSlug, releaseType, sourceKey });
    steps.sourceVerified = true;
    const job = await submitAudioJob({ admin, slug, trackSlug, releaseType,
      sourceKey: source, queuedBy, priority: 1 });
    jobId = job.id;
    hlsPrefix = job.hls_prefix || hlsPrefix;
    steps.jobQueued = true;
    clearMediaResolverCaches();
    await clearPersistedPlaybackKey(admin, slug, trackSlug);
    steps.cacheInvalidated = true;
    return { steps, jobId, hlsPrefix, sourceKeyFound: true };
  } catch (error) {
    return { steps, jobId, hlsPrefix, sourceKeyFound: steps.sourceVerified,
      error: error.message || 'Audio refresh failed', status: error.status || 500 };
  }
}
