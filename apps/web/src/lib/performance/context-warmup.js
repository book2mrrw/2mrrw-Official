"use client";

import { imagePipeline } from "@/media/imagePipeline";

const requests = new Map();
const videos = new Map();
const MAX_WARM_VIDEOS = 3;
const MAX_REQUESTS = 24;
const REQUEST_TTL_MS = 5 * 60 * 1000;

export function warmImage(src, priority = "normal", coverArtType = "image") {
  if (!src) return Promise.resolve(null);
  return imagePipeline.preload(src, priority, { coverArtType }).catch(() => null);
}

export function warmImages(items, priority = "normal") {
  return Promise.allSettled((items || []).flatMap((item) => {
    if (typeof item === "string") return [warmImage(item, priority)];
    const staticCover = item?.baseCover || item?.artwork || item?.poster_url;
    const displayCover = item?.cover;
    const work = [];
    if (staticCover) work.push(warmImage(staticCover, priority, "image"));
    if (displayCover && displayCover !== staticCover) {
      work.push(warmImage(displayCover, priority, item?.coverArtType || "image"));
    }
    return work;
  }));
}

/** Dedupe lightweight data warming. Normal browser caching remains authoritative. */
export function warmJson(url) {
  if (!url || typeof window === "undefined") return Promise.resolve(null);
  const existing = requests.get(url);
  if (existing && Date.now() - existing.createdAt < REQUEST_TTL_MS) return existing.promise;
  const request = fetch(url, { credentials: "include" })
    .then((response) => response.ok ? response.json() : null)
    .catch(() => null)
    .then((value) => {
      if (value == null) requests.delete(url);
      return value;
    });
  requests.set(url, { promise: request, createdAt: Date.now() });
  if (requests.size > MAX_REQUESTS) requests.delete(requests.keys().next().value);
  return request;
}

export function invalidateWarmJson(url) {
  requests.delete(url);
}

function warmText(url) {
  const key = `text:${url}`;
  const existing = requests.get(key);
  if (existing && Date.now() - existing.createdAt < REQUEST_TTL_MS) return existing.promise;
  const request = fetch(url, { credentials: "include" })
    .then((response) => response.ok ? response.text() : null)
    .catch(() => null);
  requests.set(key, { promise: request, createdAt: Date.now() });
  return request;
}

/** Warm only enough video data to remove first-paint initialization. */
export function warmVideo(src, poster) {
  void warmImage(poster, "high");
  if (!src || typeof document === "undefined" || videos.has(src)) return;
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.src = src;
  video.load();
  videos.set(src, video);
  if (videos.size > MAX_WARM_VIDEOS) {
    const [oldestSrc, oldest] = videos.entries().next().value;
    oldest.removeAttribute("src");
    oldest.load();
    videos.delete(oldestSrc);
  }
}

export function warmCollectorCards(cards, router) {
  router?.prefetch?.("/collectors-cards");
  void warmJson("/api/catalog/exclusive-drops");
  void warmImages(cards, "high");
  for (const card of cards || []) {
    if (card.faceType === "video") warmVideo(card.videoSrc, card.artwork);
  }
}

export function warmVault() {
  void warmJson("/api/vault/content");
  void warmJson("/api/catalog/exclusive-drops");
  void warmJson("/api/public/vault");
}

export function warmAudioVisualItem(item) {
  if (!item) return;
  void warmImage(item.poster_url, "critical");
  if (item.seriez_id) void warmJson(`/api/audio-visual/seriez/${encodeURIComponent(item.seriez_id)}`);
  if (!item.video_id) return;
  void warmJson(`/api/audio-visual/${encodeURIComponent(item.video_id)}/peek`).then((peek) => {
    if (peek?.peek_url) warmVideo(peek.peek_url, peek.poster_url || item.poster_url);
    // A manifest is lightweight but protected. Warm it only after peek confirms
    // this viewer already has full access; never probe keys or media segments.
    if (peek?.full) void warmText(`/api/audio-visual/${encodeURIComponent(item.video_id)}/manifest`);
  });
}

export async function warmAudioVisualz(type = "all") {
  const query = type === "all" ? "" : `?type=${encodeURIComponent(type)}`;
  const data = await warmJson(`/api/audio-visual/browse${query}`);
  const items = Array.isArray(data?.items) ? data.items : [];
  await warmImages(items.map((item) => item.poster_url), "high");
  for (const item of items.slice(0, 6)) warmAudioVisualItem(item);
  return data;
}
