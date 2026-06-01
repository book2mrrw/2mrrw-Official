# Current Preview Flow — Step Timing

**Probe source:** Phase 5.2.10 (`curl-measurements.txt`, 2026-05-31T17:31Z)  
**Representative release:** `hour-glass` → `previews/singles/hour-glass/hourglass-preview.mp3`  
**Code entry:** `catalogPreviewAudioUrl()` → `/api/media/preview` → 302 → R2 public CDN

---

## End-to-end waterfall (guest tap → `loadedmetadata`)

```
┌─────────────┐    ┌──────────────────────┐    ┌─────────────┐    ┌──────────────┐
│ User tap    │───▶│ catalogPreviewAudioUrl│───▶│ GET /api/   │───▶│ GET CDN MP3  │
│ playTrack   │    │ previewDiscoveryUrl   │    │ media/preview│    │ (302 target) │
└─────────────┘    └──────────────────────┘    └─────────────┘    └──────────────┘
     ~0 ms              ~0 ms (sync)              141–391 ms           115–210 ms
                                                    + redirect ~198 ms
```

---

## Client-side steps (code trace)

| Step | Location | Action | Est. ms |
|------|----------|--------|---------|
| 1 | `ReleaseCardPlayButton` / `page.js` `playCanonicalCatalogItem` | User gesture → `playTrack()` | 0–5 |
| 2 | `AudioContext.playTrackInternal` | `perfMark(PLAYBACK_REQUEST)`, normalize track | 1–3 |
| 3 | `normalizeTrackForPlayback` → `resolvePlaybackSrc` | Guest: `access.canStream=false` → preview path | 0–1 |
| 4 | `catalogPreviewAudioUrl(previewPath)` | Folder/legacy → `/api/media/preview?folder=…&legacy=…` | **0** (sync) |
| 5 | `audio.src = syncSrc` | Browser initiates same-origin GET | — |
| 6 | **Vercel edge** `/api/media/preview` | See server steps below | **141–391** TTFB |
| 7 | **Browser redirect** | Follow 302 to `pub-*.r2.dev` (new origin unless preconnected) | **~198** (`time_redirect`) |
| 8 | **CDN GET/Range** | Cloudflare + R2 public object | **115–210** TTFB |
| 9 | ID3v2 parse | ~4096 B tag before first audio frame | **15–55** (est.) |
| 10 | `loadedmetadata` / `canplay` | AudioContext handlers, preview 30s cap | variable |

**Metadata-relevant total (steps 6–9):**

| Cache state | Sum (ms) |
|-------------|----------|
| Vercel **HIT** + warm CDN | ~141 + 198 + 130 ≈ **469** |
| Vercel **STALE/MISS** + warm CDN | ~391 + 198 + 130 ≈ **719** |
| Range chain probe (`-L -r 0-0`) | **315 ms** total (redirect 198 ms) |

Full-file download (`831 KiB` MP3 via `curl -L`): **3.5–3.8 s** — not tap→metadata relevant.

---

## Server-side steps (`/api/media/preview/route.js`)

| Step | Function | When | Est. ms (origin) | Edge cached? |
|------|----------|------|------------------|--------------|
| A | Parse `folder`, `legacy`, `type` | Always | <1 | — |
| B | `normalizeToEntityFolder` | Always | <1 | — |
| C | `previewLegacyCandidates` | preview/artwork | <1 | — |
| D | **`tryCanonicalPreviewFastPath`** | `type=preview`, canonical slug match | **1–5** | Result cached as 302 |
| E | `getOrResolvePreviewMedia` | Fast path miss | **50–500+** (R2 list) | 60s in-memory per instance |
| F | `resolveWithLegacyFallback` → `resolvePreviewFile` | Slow path | R2 `ListObjectsV2` | — |
| G | `getPublicR2Url(key)` | Always before redirect | <1 | — |
| H | `NextResponse.redirect(302)` | Always | <1 | **Vercel caches 302** (max-age 300, swr 600) |

**Phase 4.8 fast path:** For canonical releases (e.g. `hour-glass`), step D returns concrete key `previews/singles/hour-glass/hourglass-preview.mp3` **without R2 list**. Edge still executes redirect build on MISS; HIT serves cached 302.

**Server-Timing segments** (`fastpath`, `resolve`, `redirect`, `total`): present on origin MISS locally; **absent on production Vercel HIT** (Phase 5.2.10).

---

## URL shape examples

| Input `previewPath` | `catalogPreviewAudioUrl` output |
|---------------------|--------------------------------|
| `previews/singles/hour-glass/` | `/api/media/preview?folder=previews%2Fsingles%2Fhour-glass%2F&legacy=previews%2Fsingles%2Fhour-glass%2Fhourglass-preview.mp3` |
| `/audio/previews/hourglass-preview.mp3` (page.js legacy) | Same API URL (via flat legacy mapping + canonical) |
| `previews/features/i-dont-believe-you/` | `/api/media/preview?folder=…&legacy=…-preview.wav` |

302 `Location`: `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/singles/hour-glass/hourglass-preview.mp3`

---

## Entitled user divergence

When `resolveTrackAccess` → `canStream=true` and session aligned:

| Step | Path |
|------|------|
| `resolvePlaybackSrc` | `/api/library/stream?slug=…&redirect=1` |
| `AudioContext` | May still hold `metadata.previewSrc` for fallback |
| Stream API | Auth + entitlement + signed R2 or redirect |

Guest preview flow above **does not run** for entitled same-origin stream (unless 401/403 fallback to `previewSrc`).

---

## Prewarm interaction (Phase 5.2.6)

`usePlaybackCardPrewarm` → `buildPlaybackUrlDescriptor` → stores `previewSrc` (still API URL). Warms **descriptor in memory**, not audio bytes. Eliminating API hop makes prewarm point directly at CDN URL — **compatible**, slightly more valuable (browser can reuse CDN connection from preconnect).

---

## Network hints

`PlaybackNetworkHints` preconnects **CDN origin only** (`getPlaybackPreconnectOrigins`). Same-origin `/api/media/preview` reuses document connection — API TTFB is pure server/edge latency, not TLS setup.

**Preconnect savings** (documented): **40–150 ms** on cold CDN TLS when hints run before first play.
