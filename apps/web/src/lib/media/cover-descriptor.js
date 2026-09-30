/**
 * Cover identity — the one place a release's artwork is decided.
 *
 * WHY THIS EXISTS
 *
 * `cover` has always meant "the thing to display", which may be an image, a
 * video, or a discovery URL that resolves to either. Nothing in the type told
 * a consumer which, so every consumer had to know out of band — and some
 * didn't. Three separate production bugs came from that one ambiguity:
 *
 *   - the global player never showed animated art for a mixtape/EP, because
 *     `cover` and `baseCover` had collapsed to the same .mp4
 *   - a release card fed `cover` to a <video poster>, which is only ever a
 *     still, so the card rendered black while audio played
 *   - the publish route wrote a discovery redirect into `cover_url`, which the
 *     image optimizer will not follow, so every new cover shipped unoptimized
 *
 * None of those were careless. They were a field that cannot be used correctly
 * without knowledge the field doesn't carry.
 *
 * A descriptor carries it:
 *
 *     still   always an image. never null, never a video, never a redirect.
 *     motion  always a video, or null. never an image.
 *     type    "video" when motion exists, else "image".
 *
 * With that, `poster={cover.still}` cannot be wrong and
 * `<video src={cover.motion}>` cannot be wrong. The distinction stops being a
 * convention people have to remember and becomes something the data enforces.
 *
 * Pure and I/O-free on purpose: it takes URLs that have already been resolved
 * by whichever catalog path is calling, so the canonical catalog and the
 * database can share one decision without sharing a URL scheme.
 */

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/**
 * A same-origin API route that 302s to whichever asset it finds, preferring
 * video. Safe as `motion`; never safe as `still`, because "prefers video" is
 * exactly the wrong answer for a poster.
 */
const DISCOVERY_RE = /^\/?api\/media\/visual(\?|$)/i;

/** True when a URL is safe to render in an <img> or a <video poster>. */
export function isStillUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  if (VIDEO_EXT_RE.test(raw)) return false;
  if (DISCOVERY_RE.test(raw.replace(/^https?:\/\/[^/]+/i, ""))) return false;
  return true;
}

/** True when a URL is safe to hand a <video> element as its source. */
export function isMotionUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  if (VIDEO_EXT_RE.test(raw)) return true;
  // A discovery URL is motion-shaped: it exists to resolve a motion asset and
  // falls back to a still only when there isn't one.
  return DISCOVERY_RE.test(raw.replace(/^https?:\/\/[^/]+/i, ""));
}

function firstStill(candidates) {
  for (const c of candidates) if (isStillUrl(c)) return String(c).trim();
  return null;
}

function firstMotion(candidates) {
  for (const c of candidates) if (isMotionUrl(c)) return String(c).trim();
  return null;
}

/**
 * Build a cover descriptor.
 *
 * Candidates are tried in order and the FIRST one valid for that slot wins, so
 * a caller can pass its whole precedence list without pre-filtering. A video
 * URL offered as a still is skipped rather than accepted — that skip is the
 * entire point of this module.
 *
 * @param {object}  input
 * @param {string|string[]} [input.still]       still candidates, best first
 * @param {string|string[]} [input.motion]      motion candidates, best first
 * @param {string}  [input.placeholder]         used when no still candidate is valid
 * @returns {{ still: string|null, motion: string|null, type: "video"|"image" }}
 */
export function resolveCoverDescriptor({ still, motion, placeholder } = {}) {
  const stillList = Array.isArray(still) ? still : [still];
  const motionList = Array.isArray(motion) ? motion : [motion];

  const resolvedStill = firstStill(stillList) || firstStill([placeholder]);
  const resolvedMotion = firstMotion(motionList);

  return Object.freeze({
    still: resolvedStill,
    motion: resolvedMotion,
    type: resolvedMotion ? "video" : "image",
  });
}

/**
 * The legacy flat fields, derived from a descriptor.
 *
 * Every existing consumer keeps reading `cover` / `baseCover` / `coverArtType`
 * / `video` exactly as before — they are now views over one decision instead of
 * four independent computations that could disagree. New code should read the
 * descriptor directly; these exist so adopting it changes nothing downstream.
 *
 * `cover` keeps its historical meaning — motion when there is motion, still
 * otherwise — because 51 files depend on that.
 */
export function coverDescriptorToLegacyFields(descriptor) {
  const { still, motion, type } = descriptor;
  return {
    cover: motion || still || "",
    baseCover: still || null,
    coverArtType: type,
    video: motion || undefined,
  };
}
