import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";

const VIDEO_OR_MOTION_RE = /\.(mp4|webm|gif)(\?|#|$)/i;

let activeLink = null;
let activeController = null;

function isPreloadableImageCover(cover, coverArtType = "image") {
  if (!cover) return false;
  if (coverArtType === "video" || coverArtType === "motion") return false;
  const raw = String(cover);
  if (VIDEO_OR_MOTION_RE.test(raw)) return false;
  return true;
}

export function cancelCoverPreload() {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
  if (activeLink?.parentNode) {
    activeLink.parentNode.removeChild(activeLink);
  }
  activeLink = null;
}

/**
 * Hint the browser to fetch cover art (static images only).
 * Cancels any in-flight preload when the track changes.
 * Does not preload signed stream URLs or video covers.
 *
 * @param {string|null|undefined} cover
 * @param {{ coverArtType?: string }} [options]
 */
export function preloadCoverImage(cover, options = {}) {
  if (typeof window === "undefined") return;

  cancelCoverPreload();

  const { coverArtType = "image" } = options;
  if (!isPreloadableImageCover(cover, coverArtType)) return;

  const url = resolveAbsoluteArtworkUrl(cover);
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return;

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;
  document.head.appendChild(link);
  activeLink = link;

  activeController = new AbortController();
  const { signal } = activeController;
  void fetch(url, {
    signal,
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
  }).catch(() => {
    /* aborted or network — non-fatal */
  });
}
