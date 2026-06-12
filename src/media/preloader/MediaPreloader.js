import { imagePipeline } from "@/media/imagePipeline";
import * as budget from "./preloadBudget";

let audioLink = null;
const warmedPreviewUrls = new Set();

function preloadAudioLink(url, trackId) {
  if (typeof document === "undefined" || !url) return;
  if (!budget.canPreload("audio") || !budget.trackPreload("audio", trackId)) return;
  if (audioLink?.parentNode) audioLink.parentNode.removeChild(audioLink);
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "fetch";
  link.href = url;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
  audioLink = link;

  if (!warmedPreviewUrls.has(url)) {
    warmedPreviewUrls.add(url);
    try {
      const warm = new Audio();
      warm.preload = "auto";
      warm.src = url;
      warm.load();
    } catch {
      /* preview warm-up is best-effort */
    }
  }
}

export function preloadTrack(trackId, audioUrl, artworkUrl, coverArtType) {
  if (artworkUrl) {
    if (budget.canPreload("artwork") && budget.trackPreload("artwork", trackId)) {
      imagePipeline.preload(artworkUrl, "high", { coverArtType });
    }
  }
  if (audioUrl && !String(audioUrl).includes("/api/library/stream")) {
    preloadAudioLink(audioUrl, trackId);
  }
}

export function cancelAll() {
  if (audioLink?.parentNode) audioLink.parentNode.removeChild(audioLink);
  audioLink = null;
  imagePipeline.cancelHints();
}
