# Full audio playback performance audit

**Date:** 2026-05-28  
**Repo:** `/Users/recharge/artist-platform`  
**Scope:** Read-only audit + permanent implementation plan (no code changes, no deploy)

---

## Executive summary

Playback is correctly built around **one hidden `<audio>` element**, **HTTP streaming** (redirect to signed R2 for entitled users; public CDN for previews), and **no blob hot path**. The dominant client-side gate is **`waitAudioSrcReady`**, which blocks `audio.play()` until `canplay` or a **3 second** timeout. The largest **content** issue is **feature previews as multi-megabyte WAVs** versus **~1 MB MP3** singles — a 4–6× download penalty on mobile. Entitled streaming adds a **same-origin API + 302** chain (with an observed **307 www redirect**) before R2 bytes arrive.

Detailed sections: see numbered files in this directory.

---

## Top 5 bottlenecks (ranked)

| Rank | Bottleneck | Est. impact (typical → poor mobile) | Primary location |
|------|------------|-------------------------------------|------------------|
| **1** | **`waitAudioSrcReady` serial gate** before `play()` | +200ms–3s | `AudioContext.js` |
| **2** | **Feature preview file size (WAV 5–6.5 MB)** vs MP3 ~1 MB | +1–6s time-to-canplay | R2 `previews/*.wav`, `catalog.js` |
| **3** | **Entitled stream waterfall** (auth + sign + 302 + R2 TTFB) | +400ms–2.5s | `route.js`, `music-access.js` |
| **4** | **Cross-track fade** (up to 300ms) before loading new src | +0–300ms | `AudioContext.js` playTrack |
| **5** | **Media Session artwork preload** (`await preloadArtwork` on play path) | +50–300ms bandwidth contention | `media-session-artwork.js` |

---

## Section index

1. [Complete playback flow map](./01-playback-flow-map.md)  
2. [Blockers before audio.play()](./02-blockers-before-play.md)  
3. [Streaming vs blob audit](./03-streaming-vs-blob.md)  
4. [R2/CDN headers (curl)](./04-r2-cdn-headers.md)  
5. [Signed URL caching](./05-signed-url-caching.md)  
6. [Preload strategy](./06-preload-strategy.md)  
7. [React remount architecture](./07-react-remount-architecture.md)  
8. [Safari mobile specifics](./08-safari-mobile.md)  
9. [Network waterfall](./09-network-waterfall.md)  
10. [Singles vs Features](./10-singles-vs-features.md)  
11. [Permanent implementation plan](./11-implementation-plan.md)  

---

## Architecture snapshot

- **Entry:** `toPlaybackTrack` → `playTrack` / `playQueue` (`AudioContext.js`)
- **Entitled src:** `/api/library/stream?slug=…&redirect=1` → 302 presigned R2 (`music-access.js`, `route.js`)
- **Preview src:** `catalogPreviewAudioUrl` → public R2 CDN
- **Telemetry:** `sendControlSystemPlaybackEvent` (deduped, async); `/api/media/playback` on play/progress
- **SW:** keep-alive ping only — no audio cache (`public/sw.js`)

---

## Singles vs features (97f2439)

Commit **97f2439** fixed features by always setting `metadata.previewSrc` and using `getTrackPreviewSrc()` on stream 401/403 fallback. **Performance gap remains:** features use **WAV** previews; singles use **MP3** — see section 10.

---

## Recommended first actions (from plan)

1. Transcode feature previews to short MP3/AAC on R2 (P0.1)  
2. Prime `audio.src` on pointerdown (P0.2)  
3. Skip cross-track fade on mobile (P0.3)  
4. Fix www/apex redirect on stream API (P1.2)  

Full file-level plan: [11-implementation-plan.md](./11-implementation-plan.md).

---

## Deliverable

Zip: `/Users/recharge/Downloads/playback-performance-audit-20260527.zip`  
Manifest: [manifest.txt](./manifest.txt)
