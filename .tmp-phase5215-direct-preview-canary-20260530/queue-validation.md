# Queue Validation — Phase 5.2.15 Direct Preview Canary

**Run date:** 2026-05-31  
**Method:** Code review (Phase 5.2.12 baseline + 5.2.13 implementation re-verification)

---

## Audit checklist

| Function | Location | Preview API dependency? | Canary result |
|----------|----------|------------------------|---------------|
| `setQueue` | `AudioContext.js` ~L2322 | No — filters `track.src` | **PASS** |
| `playNext` / `playNextInternal` | ~L2337, L2751 | No — index + `playTrackInternal` | **PASS** |
| `playPrevious` / `playPreviousInternal` | ~L2355, L2760 | No — seek-or-decrement | **PASS** |
| Auto-advance (`onEnded`) | ~L1198–1229 | No — next queued track | **PASS** |
| `resumeInternal` | ~L2410 | No — `audio.play()` on existing src | **PASS** |
| Queue build | `albumTracksForPlayback`, `toPlaybackTrack` | Resolves once at build | **PASS** |

---

## URL resolution flow (flag ON)

```
albumTracksForPlayback / toPlaybackTrack
        │
        ▼
resolvePlaybackSrc → catalogPreviewAudioUrl (direct CDN when eligible)
        │
        ▼
track.src = https://pub-*.r2.dev/previews/singles/{slug}/…
        │
        ▼
setQueue → playNext / playPrevious / onEnded / resume
```

Queue subsystem is **URL-agnostic**. No AudioContext branches on `DIRECT_PREVIEW_*`.

---

## Queue construction sites verified

| Site | Builder | Guest preview in queue? |
|------|---------|------------------------|
| Latest Singles / Featured | `ReleaseCardPlayButton` → `playQueue([track])` | Yes |
| Catalog Grid | Play button on card | Yes |
| Mixtapes & EPs / Albums | `albumTracksForPlayback` | Yes — multi-track |
| Album tracklist sheet | `AlbumTracklistSheet` | Yes |
| Library (entitled) | `toPlaybackTrack` | Stream — unaffected |

---

## `getTrackPreviewSrc` (stream fallback edge)

Re-invoked on stream 401/404/403 — uses `catalogPreviewAudioUrl`, picks up flag state.

`isFlatPreviewCdnSrc` guard rejects **flat** CDN URLs; nested canonical keys safe.

**PASS**

---

## Latency benefit on queue operations

Auto-advance and next-track navigation reuse pre-resolved CDN `src` — **skips API TTFB + 302 per track** when guest plays album queue with flag ON.

---

## Overall queue validation

**PASS** — setQueue, playNext, playPrevious, autoAdvance, resumePlayback unaffected; guest queue benefits from faster per-track src.
