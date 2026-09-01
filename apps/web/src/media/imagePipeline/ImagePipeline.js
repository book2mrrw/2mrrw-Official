import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import * as cache from "./cache";
import { enqueue } from "./priorityQueue";

const VIDEO_OR_MOTION_RE = /\.(mp4|webm|gif)(\?|#|$)/i;

function isPreloadableImage(url, coverArtType = "image") {
  if (!url) return false;
  if (coverArtType === "video" || coverArtType === "motion") return false;
  if (VIDEO_OR_MOTION_RE.test(String(url))) return false;
  return true;
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no_window"));
      return;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = url;
  });
}

function resolveUrl(cover, coverArtType) {
  if (!isPreloadableImage(cover, coverArtType)) return null;
  const url = resolveAbsoluteArtworkUrl(cover);
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return null;
  return url;
}

async function doLoad(url) {
  const cached = cache.get(url);
  if (cached) return cached;
  const img = await loadImageElement(url);
  cache.set(url, img);
  return img;
}

class ImagePipelineSingleton {
  load(cover, priority = "normal", options = {}) {
    const url = resolveUrl(cover, options.coverArtType);
    if (!url) return Promise.resolve(null);
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    return enqueue(url, priority, doLoad);
  }

  preload(cover, priority = "low", options = {}) {
    return this.load(cover, priority, options);
  }

  getFromCache(cover, options = {}) {
    const url = resolveUrl(cover, options.coverArtType);
    return url ? cache.get(url) : null;
  }

  evict(cover, options = {}) {
    const url = resolveUrl(cover, options.coverArtType);
    if (url) cache.evict(url);
  }

  /** Link preload hint — absorbs legacy preload.js behavior */
  hintPreload(cover, options = {}) {
    if (typeof document === "undefined") return;
    const url = resolveUrl(cover, options.coverArtType);
    if (!url) return;
    const existing = document.querySelector(`link[data-pipeline-preload="${url}"]`);
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    link.setAttribute("data-pipeline-preload", url);
    document.head.appendChild(link);
    void this.preload(cover, "critical", options);
  }

  cancelHints() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("link[data-pipeline-preload]").forEach((el) => el.remove());
  }
}

export const imagePipeline = new ImagePipelineSingleton();
