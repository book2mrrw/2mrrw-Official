/**
 * Element-state media readiness — the single source of truth for "has this
 * media element loaded?".
 *
 * WHY THIS EXISTS
 *
 * The DOM already knows whether a media element has loaded. Asking it is the
 * only correct way to find out, because the `load` / `loadeddata` events that
 * announce the transition do not bubble and are never replayed: an asset that
 * finishes before a listener is attached dispatches its event into nothing.
 *
 * That is not a rare edge case on this site — it is the common case for the
 * assets that matter most. A small, same-origin, HTTP-cached cover routinely
 * completes during document parse, long before React hydrates a large client
 * bundle and attaches its handlers. A reveal gate built only on events
 * therefore strands precisely the assets that loaded fastest, and strands them
 * indefinitely, because no second event is ever coming.
 *
 * So: every reveal gate reads state from here, and treats the DOM events as
 * nothing more than a notification that state may have changed. Never gate a
 * reveal on an event alone.
 *
 * Kept free of React and of any hard `window` dependency so it can be unit
 * tested against plain objects and is safe to call during a server render
 * (where it always reports "pending").
 */

/** HTMLMediaElement.HAVE_CURRENT_DATA — at least one frame is decodable. */
export const MEDIA_HAVE_CURRENT_DATA = 2;

export const MEDIA_PENDING = "pending";
export const MEDIA_READY = "ready";
export const MEDIA_FAILED = "failed";

/** The DOM event that announces a transition *into* the ready state. */
export function mediaReadyEventName(kind) {
  return kind === "video" ? "loadeddata" : "load";
}

/**
 * An SVG without intrinsic dimensions legitimately decodes to a zero natural
 * width, so for those `complete` alone is readiness. Raster formats have no
 * such case: complete with no intrinsic size means the decode failed. Every
 * cover in the catalog is raster today — this keeps the predicate correct if
 * that ever stops being true.
 */
const SIZELESS_IMAGE_RE = /\.svgz?(\?|#|$)/i;

function elementSource(element) {
  if (element.currentSrc) return element.currentSrc;
  if (typeof element.getAttribute === "function") {
    const attr = element.getAttribute("src");
    if (attr) return attr;
  }
  return element.src || "";
}

/**
 * An element with no source has not been asked to load anything yet, so it is
 * pending rather than failed — this is what keeps a server render, a detached
 * ref, and a not-yet-assigned `<video>` from being misread as a failure.
 */
function hasResolvedSource(element) {
  return Boolean(elementSource(element));
}

function imageOutcome(element) {
  // A decode failure also sets `complete`, so `complete` alone is not
  // readiness: an errored image reports complete with no intrinsic size.
  // Checking both is what lets a dropped `error` event be recovered too.
  if (!element.complete) return MEDIA_PENDING;
  if (element.naturalWidth > 0) return MEDIA_READY;
  return SIZELESS_IMAGE_RE.test(String(elementSource(element))) ? MEDIA_READY : MEDIA_FAILED;
}

function videoOutcome(element) {
  if (element.error) return MEDIA_FAILED;
  const readyState = typeof element.readyState === "number" ? element.readyState : 0;
  return readyState >= MEDIA_HAVE_CURRENT_DATA ? MEDIA_READY : MEDIA_PENDING;
}

/**
 * Current outcome for a live element: MEDIA_READY, MEDIA_FAILED or
 * MEDIA_PENDING. Never throws.
 *
 * @param {HTMLImageElement|HTMLVideoElement|null|undefined} element
 * @param {"image"|"video"} kind
 */
export function mediaElementOutcome(element, kind = "image") {
  if (!element || !hasResolvedSource(element)) return MEDIA_PENDING;
  return kind === "video" ? videoOutcome(element) : imageOutcome(element);
}

export function isMediaElementReady(element, kind = "image") {
  return mediaElementOutcome(element, kind) === MEDIA_READY;
}

export function isMediaElementFailed(element, kind = "image") {
  return mediaElementOutcome(element, kind) === MEDIA_FAILED;
}
