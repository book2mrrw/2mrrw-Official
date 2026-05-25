import { imagePipeline } from "@/media/imagePipeline";

/**
 * Delegates cover preload to the global ImagePipeline (Phase 10).
 * @param {string|null|undefined} cover
 * @param {{ coverArtType?: string }} [options]
 */
export function preloadCoverImage(cover, options = {}) {
  if (typeof window === "undefined") return;
  imagePipeline.cancelHints();
  imagePipeline.hintPreload(cover, options);
}

export function cancelCoverPreload() {
  if (typeof window === "undefined") return;
  imagePipeline.cancelHints();
}
