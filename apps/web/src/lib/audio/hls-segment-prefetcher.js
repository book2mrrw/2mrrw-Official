/** Next-track opening requests share the active rendition download scheduler. */
import { hlsDownloadManager } from './hls-download-manager';

export function cancelHlsSegmentPrefetch() {
  hlsDownloadManager.cancelSpeculation();
}

export async function prefetchHlsSegmentsForTrack(slug, trackSlug = null) {
  const params = new URLSearchParams({ slug });
  if (trackSlug && trackSlug !== slug) params.set('trackSlug', trackSlug);
  hlsDownloadManager.queueNext(`/api/library/hls?${params}`);
}
