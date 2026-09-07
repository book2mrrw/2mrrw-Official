/**
 * Phase P5 — Storefront persistent media lifecycle contract.
 *
 * Catalog card artwork (Latest Singles MP4 loops, CoverArt video type) must stay
 * mounted and decoded after first load. Scroll must not pause(), load(), or cap
 * active decoders. IO prewarm and Audio Visuals remain separate surfaces.
 */

import { getAudioMediaPrioritySnapshot } from "@/lib/media/audio-media-priority";

const CAROUSEL_VIDEO_SELECTOR = "video[data-single-carousel]";

function carouselCardRect(video) {
  const card = video.closest("[data-single-card]");
  return (card || video).getBoundingClientRect();
}

/** True when a carousel card is partially visible in the viewport (hero coordination only). */
export function isStorefrontCarouselCardInView(video) {
  const rect = carouselCardRect(video);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visibleWidth = Math.min(rect.right, vw) - Math.max(rect.left, 0);
  const minVisible = Math.max(48, Math.min(rect.width, vw) * 0.35);
  const verticallyVisible = rect.bottom > 0 && rect.top < vh;
  return verticallyVisible && visibleWidth >= minVisible;
}

/**
 * Persistent contract: start or resume muted loops; never pause on scroll, never load().
 * @param {HTMLElement | null} row - singles row container (singlesRowRef.current)
 * @param {string | null} [exceptSlug] - the release whose own video is currently
 *   playing full audio and must stay animated (see pauseStorefrontCarouselVideos).
 * @returns {boolean} anyCarouselInView - for mobile hero coordination
 */
export function ensureStorefrontCarouselVideosPlaying(row, exceptSlug = null) {
  if (!row || document.hidden) return false;
  if (getAudioMediaPrioritySnapshot().active) {
    pauseStorefrontCarouselVideos(row, exceptSlug);
    return false;
  }
  let anyCarouselInView = false;
  row.querySelectorAll(CAROUSEL_VIDEO_SELECTOR).forEach((video) => {
    if (isStorefrontCarouselCardInView(video)) anyCarouselInView = true;
    if (video.paused) {
      video.play().catch(() => {});
    }
  });
  return anyCarouselInView;
}

/** Document hidden only — OS/tab background, not scroll offscreen. Pauses everything, no exception: the tab isn't visible at all. */
export function pauseStorefrontCarouselVideosWhenDocumentHidden(row) {
  if (!row || !document.hidden) return;
  pauseStorefrontCarouselVideos(row);
}

/**
 * Pause carousel decoders (playback contention / memory trim — not scroll offscreen).
 * @param {HTMLElement | null} row
 * @param {string | null} [exceptSlug] - skip the video tagged with this
 *   data-release-slug — the release actually playing right now keeps its
 *   own cover animated instead of being blanket-suspended with the rest.
 */
export function pauseStorefrontCarouselVideos(row, exceptSlug = null) {
  if (!row) return;
  row.querySelectorAll(CAROUSEL_VIDEO_SELECTOR).forEach((video) => {
    if (exceptSlug && video.dataset.releaseSlug === exceptSlug) return;
    try {
      video.pause();
    } catch {
      /* non-fatal */
    }
  });
}

/**
 * In-view carousel loops are already mounted and playing — skip redundant ensure on wake/resize.
 */
export function isStorefrontCarouselMediaHealthy(row) {
  if (!row || document.hidden) return false;
  const videos = row.querySelectorAll(CAROUSEL_VIDEO_SELECTOR);
  if (!videos.length) return false;
  let hasInView = false;
  for (const video of videos) {
    if (!isStorefrontCarouselCardInView(video)) continue;
    hasInView = true;
    if (video.paused || video.readyState < 2) return false;
  }
  return hasInView;
}

/**
 * Mobile hero: pause ambient hero when singles row has in-view carousel decoders.
 * Does not pause or load() carousel videos.
 */
export function syncMobileHeroWithStorefrontCarousel(heroVideo, anyCarouselInView, isMobile) {
  if (!heroVideo || !isMobile) return;
  if (anyCarouselInView) {
    try {
      heroVideo.pause();
    } catch {
      /* non-fatal */
    }
  } else {
    heroVideo.play().catch(() => {});
  }
}
