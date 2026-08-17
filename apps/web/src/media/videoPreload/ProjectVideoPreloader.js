/**
 * ProjectVideoPreloader — OWNER of project-wide background video preload scheduling.
 *
 * Preloads HLS manifests + initial segments for ALL eligible tracks in a project.
 * Does NOT create HLS.js instances — uses fetch() for manifests and initial segments only.
 * This keeps memory bounded and avoids HLS playback conflicts.
 *
 * Priority system:
 *   P0 — current playing track   (immediate, no yield)
 *   P1 — visible-in-viewport tracks  (next after P0)
 *   P2 — remaining project tracks  (yield to foreground, bounded concurrency)
 *
 * CDN-oriented: all fetches hit Cloudflare R2 / HLS CDN. No unnecessary origin traffic.
 * Deduplicated by mediaKey — never fetches the same segment twice per session.
 *
 * Concurrency: max 3 simultaneous fetches (never starves the foreground audio stream).
 *
 * Usage:
 *   ProjectVideoPreloader.schedule({ tracks, currentTrackId, visibleTrackIds })
 *   ProjectVideoPreloader.cancel()   // call on project unmount
 */

const MAX_CONCURRENT = 3;
const _fetched = new Set();         // deduplication across calls
let _queue     = [];
let _active    = 0;
let _cancelled = false;

function _mediaKey(track) {
  return track.hls_slug || track.r2_key || track.slug || null;
}

async function _fetchManifest(url) {
  try {
    const res = await fetch(url, { method: "GET", priority: "low" });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function _fetchSegment(url) {
  try {
    await fetch(url, { method: "GET", priority: "low" });
  } catch {}
}

async function _preloadTrack(track) {
  if (!track?.hls_manifest_url && !track?.video_hls_url) return;
  const manifestUrl = track.video_hls_url || track.hls_manifest_url;
  if (!manifestUrl) return;

  const manifest = await _fetchManifest(manifestUrl);
  if (!manifest || _cancelled) return;

  // Parse first segment from M3U8 and prefetch it (warms CDN edge cache)
  const lines = manifest.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const segUrl = trimmed.startsWith("http")
        ? trimmed
        : new URL(trimmed, manifestUrl).href;
      if (!_fetched.has(segUrl)) {
        _fetched.add(segUrl);
        await _fetchSegment(segUrl);
      }
      break; // first segment only
    }
  }
}

function _drain() {
  if (_cancelled) return;
  while (_active < MAX_CONCURRENT && _queue.length > 0) {
    const track = _queue.shift();
    const key = _mediaKey(track);
    if (!key || _fetched.has(key)) { _drain(); return; }
    _fetched.add(key);
    _active++;
    // Yield to foreground before each fetch
    requestIdleCallback
      ? requestIdleCallback(() => {
          _preloadTrack(track).finally(() => { _active--; _drain(); });
        }, { timeout: 5000 })
      : setTimeout(() => {
          _preloadTrack(track).finally(() => { _active--; _drain(); });
        }, 100);
  }
}

/**
 * Schedule preload for all tracks in a project.
 * @param {object} opts
 * @param {object[]} opts.tracks          — all tracks with video assets
 * @param {string}  [opts.currentTrackId] — P0 priority
 * @param {string[]}[opts.visibleTrackIds]— P1 priority
 */
function schedule({ tracks = [], currentTrackId = null, visibleTrackIds = [] }) {
  if (!Array.isArray(tracks) || tracks.length === 0) return;
  _cancelled = false;

  const visibleSet = new Set(visibleTrackIds);

  const p0 = tracks.filter(t => t.id === currentTrackId || t.track_id === currentTrackId);
  const p1 = tracks.filter(t => visibleSet.has(t.id) || visibleSet.has(t.track_id));
  const p2 = tracks.filter(t => !p0.includes(t) && !p1.includes(t));

  // Rebuild queue without duplicating already-fetched keys
  const seen = new Set();
  const ordered = [...p0, ...p1, ...p2].filter(t => {
    const k = _mediaKey(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return !_fetched.has(k);
  });

  _queue = ordered;
  _drain();
}

/** Cancel all pending preloads (call on project unmount). */
function cancel() {
  _cancelled = true;
  _queue = [];
}

/** Reset deduplication cache (call on session end or auth change). */
function reset() {
  cancel();
  _fetched.clear();
  _active = 0;
  _cancelled = false;
}

export const ProjectVideoPreloader = { schedule, cancel, reset };
