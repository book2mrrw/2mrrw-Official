# Prewarm Validation — Cache, Hook, Card Shell

**Section result: PASS**

Card prewarm stores **resolved URL strings** via the same `catalogPreviewAudioUrl` entry point as playback. Direct CDN activation **improves** prewarm (browser can warm CDN connection without API hop).

---

## Component chain

```
PlaybackPrewarmCardShell (layout wrapper)
        │
        ▼
usePlaybackCardPrewarm (IntersectionObserver)
        │
        ▼
buildReleasePrewarmBundle → buildPlaybackUrlDescriptor
        │
        ▼
catalogPreviewAudioUrl(previewPath) → previewSrc in cache
        │
        ▼
ReleaseCardPlayButton.getPlaybackPrewarmEntry → toPlaybackTrack
```

---

## `playback-prewarm-cache.js`

```58:89:src/lib/playback/playback-prewarm-cache.js
export function buildPlaybackUrlDescriptor(normalizedItem, access, ...) {
  const previewPath = normalizedItem?.preview || normalizedItem?.preview_path || ...;
  const previewSrc = previewPath ? catalogPreviewAudioUrl(previewPath) : null;
  const streamPath = canStream ? libraryStreamRedirectSrc(...) : null;
  return { previewPath, previewSrc, streamPath, ... };
}
```

| Field | Today | After activation |
|-------|-------|------------------|
| `previewSrc` | `/api/media/preview?...` | `https://pub-*.r2.dev/...` (when keyed) |
| `streamPath` | `/api/library/stream?...` | Unchanged |
| `queueDescriptors` | Slug/index only — no URLs | Unchanged |

**No cache logic branches on API hostname.**

---

## `usePlaybackCardPrewarm.js`

- Fires once per card when ≥15% visible (`threshold: 0.15`, `rootMargin: 80px`).
- **No network fetch** — memory-only descriptor warm.
- After activation: warmed `previewSrc` may allow `MediaPreloader` / browser to prefetch CDN earlier.

---

## `PlaybackPrewarmCardShell.js`

- Wraps `LatestSinglesStyleRow` and `CatalogGrid` cards (`data-playback-prewarm-card`).
- Does not alter layout or play handlers.

---

## `ReleaseCardPlayButton.js`

**Separate prewarm path:**

```23:33:src/components/music/ReleaseCardPlayButton.js
const previewUrl = previewPath ? catalogPreviewAudioUrl(previewPath) : ...;
preloadTrack(item?.slug, previewUrl, coverDisplay.src, coverDisplay.type);
```

- `preloadTrack` benefits from **direct CDN** (one fewer redirect for link prefetch).
- Play handler uses `getPlaybackPrewarmEntry` → `toPlaybackTrack` → `playQueue` — inherits same `src` as `resolvePlaybackSrc`.

---

## `PlaybackNetworkHints.js`

```1:20:src/components/system/PlaybackNetworkHints.js
// Preconnect to getPlaybackPreconnectOrigins() — CDN base only today
```

- Already preconnects public CDN (`play-path-domains.js`).
- Comment notes same-origin preview API — after activation, **more traffic shifts to preconnected CDN** (positive).

---

## Consistency requirement

| Risk | Mitigation |
|------|------------|
| Prewarm CDN URL ≠ tap `src` | Single resolver (`catalogPreviewAudioUrl`) — same function for both |
| Stale cache after flag flip | LRU 96 entries TTL by navigation — acceptable |

---

## Verdict

**PASS** — Prewarm requires **no structural changes**; automatically picks up resolver output. Optional QA: confirm `preloadTrack` does not CORS-fail on direct CDN (already validated post-302 in Phase 5.2.10).
