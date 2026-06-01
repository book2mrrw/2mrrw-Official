# Phase 5.2.9 — Prewarm Effectiveness

**Systems:** `usePlaybackCardPrewarm`, `playback-prewarm-cache.js`, `PlaybackNetworkHints`, `PlaybackPrewarmCardShell`

---

## What prewarm does

| Layer | Warms | Does **not** warm |
|-------|-------|-------------------|
| **Card IO** (`IntersectionObserver`) | Playback descriptors, `previewSrc` / `streamPath` URLs, queue metadata, access snapshot | Audio bytes, `<audio>` buffer, `loadedmetadata` |
| **Network hints** (`<link rel="preconnect">`) | DNS + TCP + TLS to `pub-643…r2.dev` | API redirect, signed stream host |
| **Prewarm cache hit on tap** | Skips URL rebuild / resolver when key matches | Does not skip fetch if `src` changes |

From `usePlaybackCardPrewarm.js` comment: *"No autoplay, no audio bytes, no signed URL fetch, no entitlement consumption."*

---

## Effect on src → loadedmetadata

| Condition | Expected `playback-src-to-loadedmetadata` |
|-----------|-------------------------------------------|
| Card **not** prewarmed, cold CDN | **120–250 ms** |
| Card prewarmed (hints + scroll into view), first tap | **80–180 ms** (saves **40–150 ms** DNS/TLS per `PRECONNECT_SETUP_SAVINGS_MS`) |
| Same `src` replay (`guard-same-src`) | **0–2 ms** (no network) |
| Prewarm cache only (URL ready) but cold connection | **131–195 ms** TTFB still applies |

**Conclusion:** Prewarm **partially** addresses root cause #2 (cold TLS); **does not** address #1 (CDN TTFB **131–195 ms**) or #3 (parse **15–55 ms**).

---

## Code path on tap (prewarmed card)

1. `getPlaybackPrewarmEntry(key)` → cached `previewSrc` / `streamPath`
2. `playTrackInternal` → may skip catalog normalization work (~1–15 ms, not src→metadata)
3. `waitAudioSrcReady` → `audio.src = previewSrc` → network fetch still required

---

## Measurement procedure (dev)

1. `npm run dev`, open home catalog.
2. **A — No prewarm:** Hard refresh; immediately tap first visible card (before scroll).
3. **B — Prewarm:** Hard refresh; scroll slowly so cards enter viewport (IO threshold 0.15, rootMargin 80px); wait 2 s; tap same card.
4. Compare:

```js
window.dumpPlaybackTiming().measures["playback-src-to-loadedmetadata"];
window.dumpPlaybackTiming().sourceAcquisition; // tlsMs, dnsMs
```

5. **C — Same track replay:** Tap same card twice without navigation — expect `guard-same-src-fast-path`.

---

## Prewarm vs API redirect

Even with CDN preconnect, guest path may still call `/api/media/preview` if `catalogPreviewAudioUrl` returns API discovery URL. That adds **~362 ms–1.2 s** **before** `src` assign — outside src→metadata but affects tap→metadata.

**Card prewarm** builds `previewSrc` via `catalogPreviewAudioUrl` — if result is direct CDN URL, API 302 may be skipped on tap.

---

## Effectiveness score (forensic)

| Goal | Effectiveness |
|------|----------------|
| Reduce DNS/TLS on first CDN fetch | **Medium** (40–150 ms potential) |
| Reduce CDN TTFB | **None** |
| Reduce ID3/parse | **None** |
| Skip network on replay | **High** (same-src guard) |
