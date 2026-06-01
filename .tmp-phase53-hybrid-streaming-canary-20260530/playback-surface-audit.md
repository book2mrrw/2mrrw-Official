# Playback Surface Audit — Hybrid Streaming Canary (Phase 5.3)

**Run date:** 2026-05-31  
**Prior audits:** Phase 5.2.12 (preview surfaces), Phase 5.2.14 (entitlement surfaces)  
**Section result:** **PASS** (code-path)

---

## Classification

| Class | Description | Hybrid impact |
|-------|-------------|---------------|
| **G** | Guest preview path | **None** — preview CDN/API |
| **E** | Entitled stream path | **Server resolver only** — same client URL |
| **I** | Indirect (queue uses pre-built `src`) | Inherits upstream class |

Hybrid flags are server-only. All surfaces continue using existing `resolvePlaybackSrc` → `libraryStreamRedirectSrc` for entitled users.

---

## Surface matrix

| Surface | Component | Guest | Entitled | Class | Hybrid change |
|---------|-----------|-------|----------|-------|---------------|
| **Latest Singles** | `LatestSinglesStyleRow` + `ReleaseCardPlayButton` | Preview | Stream API | G / E | Server picks AAC vs master |
| **Featured row** | `LatestSinglesStyleRow` (`cardMedia=cover`) | Preview | Stream API | G / E | Same |
| **Catalog Grid** | `CatalogGrid` + `PlaybackPrewarmCardShell` | Preview | Stream API | G / E | Prewarm uses same stream URL |
| **Mixtapes & EPs** | Grid + `albumTracksForPlayback` | Preview | Stream + trackSlug | G / E | Per-track stream registration |
| **Albums grid** | `albumCardPlaybackItem` (track 0) | Preview | Stream + trackSlug | G / E | Same |
| **Album tracklist** | `AlbumTracklistSheet` → `playQueue` | Preview per track | Stream per track | G / E | Same |
| **Album modal** | `page.js` `albumTracksForPlayback` | Preview | Stream queue | G / E | Same |
| **Features modal** | `ImmersivePreviewModal` | Preview | Stream | G / E | Same |
| **Singles preview modal** | `playCanonicalCatalogItem` | Preview | Stream | G / E | Same |
| **Search (Music tab)** | Filtered cards | Preview | Stream | G / E | Same components |
| **Queue playback** | `AudioContext.setQueue` | Preview `src` | Stream `src` | I | Payload differs; engine same |
| **Auto-advance** | `onEnded` → `playTrack` | Preview cap 30s | Full stream | I | Same navigation |
| **Next / Previous** | `playNextInternal` / `playPreviousInternal` | Same | Same | I | No entitlement fork |
| **Resume** | `resumeInternal` | Preview seek cap | Stream URL refresh | I | Entitled may refresh signed URL |
| **Continue listening** | `ContinueListening` | Preview | Stream | G / E | Same resolver |
| **Card prewarm** | `usePlaybackCardPrewarm` | Preview descriptor | Stream path | G / E | Prewarm unchanged contract |
| **Library / My Music** | `MyMusicTab` | Gated (`!canStream`) | Stream | E | UI gate unchanged |
| **Vault** | `/api/vault/media` | N/A | Vault gated | N/A | **Out of hybrid scope** |
| **Stream 401 fallback** | `AudioContext.getTrackPreviewSrc` | Preview fallback | N/A | G | Unchanged |

---

## Unified playback engine

All surfaces converge on:

```
toPlaybackTrack / normalizeTrackForPlayback
  → resolveTrackAccess
  → resolvePlaybackSrc
  → playQueue / playTrack
  → AudioContext.playTrackInternal (single <audio>)
```

**No surface reads hybrid flags directly.**

---

## Entitled path detail

```javascript
// music-access.js
libraryStreamRedirectSrc(slug, { trackSlug })
// → /api/library/stream?slug=…&redirect=1[&trackSlug=…]

// route.js → resolvePlaybackKey → [stream gate] → sign → proxy
```

Client never sees R2 key or stream vs master decision.

---

## Queue / continuity (Phase 5.2.14 confirmed)

| Behavior | Entitlement fork in navigation? |
|----------|--------------------------------|
| `setQueue` | ❌ Filters `t.src` only |
| Auto-advance | ❌ Same `playTrackRef` |
| Shuffle / repeat | ❌ |
| Media Session skip | ❌ |
| Resume | ❌ (entitled may refresh stream URL) |

Hybrid affects **what bytes** server proxies, not **how queue navigates**.

---

## Prewarm interaction

`PlaybackPrewarmCardShell` + `playback-prewarm-cache.js`:

- Stores `firstTrackPlayback` from `toPlaybackTrack` (entitlement-aware)
- Prewarm network hints for stream domain — unchanged
- Hybrid does not add new prewarm branch

---

## Direct preview interaction

For hybrid-only canary, direct preview flags **OFF**:

- Guest surfaces unchanged (API+302 or existing CDN behavior)
- Entitled surfaces use hybrid resolver when flags ON

Surfaces can be tested independently.

---

## Runtime validation status

| Surface | Code-path | Device runtime |
|---------|-----------|----------------|
| All listed | ✅ Verified | ⏳ Staging QA pending |
| Tap→audible hybrid | N/A client | ⏳ Requires backfill + subscriber session |

---

## Section result

**PASS** — All playback surfaces route through unified engine. Hybrid is server-internal to `/api/library/stream`. No surface-specific code changes required for canary.
