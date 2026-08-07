/**
 * Chopped & Slowed asset preloading.
 * Extracted verbatim from AudioContext.js (lines 868–901).
 */

import { resolveCoverMediaType } from "@/lib/media/cover-media-type";

function preloadCsAssets(track, refs) {
  // Abort previous CS media before dereferencing — prevents abandoned Audio/Video
  // elements from continuing to download CS bytes and competing for bandwidth.
  const prevAudio = refs.csAudioRef.current;
  if (prevAudio) { try { prevAudio.src = ""; prevAudio.load(); } catch {} }
  const prevVid = refs.csVidRef.current;
  if (prevVid) { try { prevVid.src = ""; prevVid.load(); } catch {} }

  refs.csImgRef.current = null;
  refs.csVidRef.current = null;
  refs.csAudioRef.current = null;
  if (!track) return;
  if (track.csCover) {
    const mediaType = resolveCoverMediaType(track.csCover, track.csCoverType);
    if (mediaType === "video") {
      const vid = document.createElement("video");
      vid.preload = "auto";
      vid.src = track.csCover;
      vid.load();
      refs.csVidRef.current = vid;
    } else {
      const img = new Image();
      img.src = track.csCover;
      refs.csImgRef.current = img;
    }
  }
  if (track.csAudio) {
    const preload = new Audio();
    preload.preload = "auto";
    preload.src = track.csAudio;
    preload.load();
    refs.csAudioRef.current = preload;
  }
}

export { preloadCsAssets };
