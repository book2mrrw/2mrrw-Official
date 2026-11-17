/**
 * First-play warm cache for HLS.
 *
 * Starting an entitled track costs four serial round trips before the first
 * audible sample: master playlist -> variant playlist -> AES-128 key -> first
 * segment. When a track's card comes into view, or the listener signals intent
 * (hover, touch, sheet open), this fetches that chain once in the background,
 * and the hls.js loaders built here serve it from memory when the track is
 * played, so a tap starts from the opening segment instead of the network.
 *
 * Bounded by design:
 * - one warm at a time; intent jumps the queue, visibility waits its turn, and
 *   background (visibility) warms wait until the page's initial load settles so
 *   they never compete with it — on a congested launch a 1 KB master measured
 *   26 s; intent warms go immediately; a failed warm is retried once, later;
 * - at most WARM_STARTS_PER_MINUTE new tracks per minute (the master route
 *   allows 60/min/user, the key route 30/min/user, and real plays need room);
 * - only the rendition the engine will start on (same rule as HLSEngine's
 *   MANIFEST_PARSED: pinned quality, else the network hint, else highest),
 *   and only its opening segment;
 * - every warmed response is served once, and a warm master is only served
 *   within MASTER_TTL_MS, so each play start rests on a recent authorization.
 *
 * No server side effects: these routes authorize and sign. Play sessions and
 * stream events are created only when a track actually plays.
 */

import { hasSegment, setSegment } from "./hls-segment-cache";
import { parseEncryptedRendition, parseVariants } from "./hls-download-manager";
import { getQualityLevel, getStartupQualityLevel } from "./network-quality";

export const MASTER_TTL_MS = 4 * 60 * 1000;
export const WARM_STARTS_PER_MINUTE = 12;
const MAX_QUEUE = 6;
const MAX_WARM_TRACKS = 8;
// Background requests: generous, so a congested network delays a warm rather than failing it.
const REQUEST_TIMEOUT_MS = 20_000;
let retryDelayMs = 15_000;

/** warm request identity (pathname + search) -> { body, expires } */
const responses = new Map();
/** master identity -> identities warmed with it (for LRU eviction) */
const tracks = new Map();
/** pending warms: { path, intent, attempts } */
const queue = [];
const recentStarts = [];
let draining = false;
let retryTimer = null;
const retryTimers = new Set();
let settled = null;

/** Resolves once the page's initial load is done and the main thread is idle. */
function pageSettled() {
  if (typeof document === "undefined" || typeof window === "undefined") return Promise.resolve();
  settled ||= new Promise((resolve) => {
    const idle = () => (typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(() => resolve(), { timeout: 3000 })
      : setTimeout(resolve, 1000));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
  return settled;
}

/** The master playlist path PlaybackStreamCommands requests for this track. */
export function hlsMasterPath(slug, trackSlug = null) {
  const params = new URLSearchParams({ slug });
  if (trackSlug && trackSlug !== slug) params.set("trackSlug", trackSlug);
  return `/api/library/hls?${params}`;
}

/**
 * Responses are keyed by path + query, so the same request matches whichever
 * origin resolved it (www, apex, or the 2MRRW app's own origin).
 */
function identity(url) {
  try {
    const parsed = new URL(url, globalThis.location?.href || "https://www.2mrrw.com/");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function take(url) {
  const id = identity(url);
  const entry = id && responses.get(id);
  if (!entry) return null;
  responses.delete(id);
  return entry.expires > Date.now() ? entry.body : null;
}

/** Warm master playlist text for `url`, served once. */
export function takeWarmPlaylist(url) {
  const body = take(url);
  return typeof body === "string" ? body : null;
}

/** Warm key bytes for `url`, served once as a consumer-owned copy. */
export function takeWarmKey(url) {
  const body = take(url);
  return body instanceof ArrayBuffer ? body.slice(0) : null;
}

function isWarm(masterId) {
  const entry = responses.get(masterId);
  return Boolean(entry && entry.expires > Date.now());
}

function constrained() {
  const connection = globalThis.navigator?.connection;
  return Boolean(connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType));
}

/**
 * Queue the first-play chain of a track for warming. `intent` (hover, touch,
 * sheet open) puts it at the front; visibility warms wait their turn.
 */
export function warmHlsStart(slug, trackSlug = null, { intent = false } = {}) {
  if (!slug || typeof window === "undefined" || typeof fetch !== "function" || constrained()) return;
  const masterPath = hlsMasterPath(slug, trackSlug);
  const masterId = identity(masterPath);
  if (!masterId || isWarm(masterId)) return;
  enqueue({ path: masterPath, intent, attempts: 0 });
}

function enqueue(job) {
  const queued = queue.findIndex((pending) => pending.path === job.path);
  if (queued >= 0) {
    if (job.intent && !queue[queued].intent) {
      const [pending] = queue.splice(queued, 1);
      pending.intent = true;
      queue.unshift(pending);
    }
    return;
  }
  if (job.intent) queue.unshift(job);
  else if (queue.length < MAX_QUEUE) queue.push(job);
  else return;
  if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE; // drop the stalest visibility warms
  void drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const now = Date.now();
      while (recentStarts.length && now - recentStarts[0] > 60_000) recentStarts.shift();
      if (recentStarts.length >= WARM_STARTS_PER_MINUTE) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void drain(), 60_000 - (now - recentStarts[0]) + 50);
        return;
      }
      if (!queue[0].intent) await pageSettled(); // an intent warm may jump ahead meanwhile
      const job = queue.shift();
      if (!job || isWarm(identity(job.path))) continue;
      recentStarts.push(Date.now());
      try {
        await warmTrack(job.path);
      } catch {
        if (job.attempts === 0) {
          const timer = setTimeout(() => {
            retryTimers.delete(timer);
            if (!isWarm(identity(job.path))) enqueue({ ...job, intent: false, attempts: 1 });
          }, retryDelayMs);
          retryTimers.add(timer);
        }
      }
    }
  } finally {
    draining = false;
  }
}

async function request(url, as) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
    if (!response.ok) throw new Error(`warm ${response.status}`);
    const body = as === "text" ? await response.text() : await response.arrayBuffer();
    return { body, url: response.url || new URL(url, globalThis.location?.href || "https://www.2mrrw.com/").href };
  } finally {
    clearTimeout(timer);
  }
}

/** Same choice as HLSEngine's MANIFEST_PARSED for a fresh load. */
async function startupVariant(variants) {
  const pinned = await getQualityLevel();
  const tier = pinned >= 0 ? pinned : getStartupQualityLevel();
  return variants[tier >= 0 ? Math.min(tier, variants.length - 1) : 0];
}

function keyUrlOf(rendition, base) {
  const line = rendition.split(/\r?\n/).find((l) => l.startsWith("#EXT-X-KEY:"));
  const uri = line?.match(/URI="([^"]+)"/)?.[1];
  return uri ? new URL(uri, base).href : null;
}

async function warmTrack(masterPath) {
  const master = await request(masterPath, "text");
  const variants = parseVariants(master.body, master.url);
  if (!variants.length) return;
  const variant = await startupVariant(variants);
  const rendition = await request(variant.url, "text");
  const segments = parseEncryptedRendition(rendition.body, rendition.url);
  const keyUrl = keyUrlOf(rendition.body, rendition.url);
  const key = keyUrl ? await request(keyUrl, "bytes") : null;

  const expires = Date.now() + MASTER_TTL_MS;
  const warmed = [
    [identity(masterPath), master.body],
    [identity(variant.url), rendition.body],
    ...(key ? [[identity(keyUrl), key.body]] : []),
  ];
  const masterId = warmed[0][0];
  forget(masterId);
  for (const [id, body] of warmed) responses.set(id, { body, expires });
  tracks.set(masterId, warmed.map(([id]) => id));
  while (tracks.size > MAX_WARM_TRACKS) forget(tracks.keys().next().value);

  // The opening segment goes to the shared segment cache the fragment loader
  // already serves from (public, untokenized CDN URL; encrypted bytes).
  const opening = segments[0];
  if (opening && !hasSegment(opening)) {
    const segment = await request(opening, "bytes");
    setSegment(opening, segment.body);
  }
}

function forget(masterId) {
  for (const id of tracks.get(masterId) || []) responses.delete(id);
  tracks.delete(masterId);
}

/** Test-only: reset all warm state (and optionally the retry delay). */
export function resetHlsStartWarm({ retryDelay = 15_000 } = {}) {
  responses.clear();
  tracks.clear();
  queue.length = 0;
  recentStarts.length = 0;
  draining = false;
  settled = null;
  clearTimeout(retryTimer);
  retryTimers.forEach(clearTimeout);
  retryTimers.clear();
  retryDelayMs = retryDelay;
}

/** Resolves once no warm is running (rate-deferred warms may still be queued). */
export async function hlsStartWarmIdle() {
  while (draining) await new Promise((resolve) => setTimeout(resolve, 5));
}

// ─── hls.js loaders ──────────────────────────────────────────────────────────

const loaderClasses = new WeakMap();

/**
 * `pLoader` (playlists) and `loader` (keys) classes that serve warm responses
 * from memory and otherwise defer to the default loader unchanged.
 */
export function createWarmLoaderClasses(DefaultLoader) {
  if (loaderClasses.has(DefaultLoader)) return loaderClasses.get(DefaultLoader);

  const deliver = (loader, body, context, callbacks) => {
    const generation = loader._warmGeneration;
    const size = typeof body === "string" ? body.length : body.byteLength;
    const now = performance.now();
    const stats = loader.stats;
    stats.aborted = false;
    stats.loaded = size;
    stats.total = size;
    stats.retry = 0;
    stats.chunkCount = 1;
    stats.loading.start = now;
    stats.loading.first = now;
    stats.loading.end = now;
    queueMicrotask(() => {
      if (generation !== loader._warmGeneration || stats.aborted) return;
      callbacks.onSuccess({ url: context.url, data: body }, stats, context, null);
    });
  };

  const withWarmDelivery = (Base, takeWarm) =>
    class extends Base {
      constructor(config) {
        super(config);
        this._warmGeneration = 0;
      }

      load(context, config, callbacks) {
        this._warmGeneration += 1;
        const body = takeWarm(context);
        if (body != null) deliver(this, body, context, callbacks);
        else super.load(context, config, callbacks);
      }

      abort() {
        this._warmGeneration += 1;
        super.abort();
      }

      destroy() {
        this._warmGeneration += 1;
        super.destroy();
      }
    };

  const classes = {
    pLoader: withWarmDelivery(DefaultLoader, (context) => takeWarmPlaylist(context.url)),
    loader: withWarmDelivery(DefaultLoader, (context) =>
      context.responseType === "arraybuffer" ? takeWarmKey(context.url) : null),
  };
  loaderClasses.set(DefaultLoader, classes);
  return classes;
}
