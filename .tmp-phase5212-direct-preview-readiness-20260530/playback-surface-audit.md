# Playback Surface Audit — Preview API (A) vs Direct CDN (B)

**Resolver funnel:** `preview_path` → `catalogPreviewAudioUrl()` (`src/lib/media-urls.js`) → today always `previewDiscoveryUrl()` → `/api/media/preview` → 302 → public R2 CDN.

**Entitled path (orthogonal):** `resolvePlaybackSrc` → `libraryStreamRedirectSrc` → `/api/library/stream` — never preview API for primary guest-entitled playback.

---

## Classification matrix

| Surface | Component / entry | Guest preview | Entitled | Class | Uses preview API today? |
|---------|-------------------|---------------|----------|-------|-------------------------|
| **Latest Singles** | `LatestSinglesStyleRow` + `ReleaseCardPlayButton` | ✅ | Stream | **B** | ✅ |
| **Home carousel / hero** | `page.js` `playCanonicalCatalogItem` | ✅ | Stream | **B** | ✅ |
| **Featured row** | `LatestSinglesStyleRow` (`cardMedia=cover`) | ✅ | Stream | **B** | ✅ |
| **Features modal** | `ImmersivePreviewModal` → `playCanonicalCatalogItem(..., "feature_modal")` | ✅ | Stream | **B** | ✅ |
| **Singles preview modal** | `playCanonicalCatalogItem(..., "preview_modal")` | ✅ | Stream | **B** | ✅ |
| **Albums grid** | `CatalogGrid` → `albumCardPlaybackItem` (track 0) | ✅ | Stream + `trackSlug` | **B** | ✅ |
| **Album tracklist sheet** | `AlbumTracklistSheet` → `albumTracksForPlayback` → `playQueue` | ✅ per track | Stream per track | **B** / **A** | ✅ |
| **Album modal (multi-track)** | `page.js` `albumTracksForPlayback` / `playAlbumTracks` | ✅ | Stream queue | **B** / **A** | ✅ |
| **Mixtapes & EPs** | Grid + row (`mixtapes-and-eps` paths) | ✅ | Stream | **B** | ✅ |
| **Search (Music tab)** | `page.js` L2195 placeholder filter — same cards | ✅ | Stream | **B** | ✅ (via cards) |
| **Queue playback** | `AudioContext.setQueue` / `playQueue` — `track.src` | ✅ | Stream | **B** / **A** | Indirect (src built upstream) |
| **Auto-advance** | `onEnded` → `playTrack(..., QUEUE_AUTO_ADVANCE)` | ✅ | Stream | **B** / **A** | Indirect |
| **Prev / Next** | `playNextInternal` / `playPreviousInternal` | ✅ | Stream | **B** / **A** | Indirect |
| **Resume** | `resumeInternal` — same element `src` | ✅ | Stream refresh if entitled | **B** / **A** | Indirect |
| **Continue listening** | `ContinueListening` → `resolvePlaybackSrc` | ✅ guest | Stream | **B** | ✅ |
| **Card prewarm** | `PlaybackPrewarmCardShell` → `buildPlaybackUrlDescriptor` | ✅ | `streamPath` | **B** | ✅ (`previewSrc`) |
| **MediaPreloader** | `ReleaseCardPlayButton` `preloadTrack` | ✅ | — | **B** | ✅ |
| **Library / My Music** | Entitled only | ❌ | Stream | **N/A** | ❌ |
| **Stream 401/403 fallback** | `AudioContext` `getTrackPreviewSrc` | ✅ | Fallback | **B** | ✅ |
| **Vault** | `/api/vault/media` | — | Gated | **N/A** | ❌ |

---

## Code path notes

### Singles / features (guest)

1. `page.js` legacy `preview: "/audio/previews/…"` or folder `previews/features/{slug}/`
2. `withR2CatalogMedia` → `catalogPreviewAudioUrl` on `preview` field
3. `normalizeTrackForPlayback` → `resolvePlaybackSrc` → same URL in `track.src`
4. **After activation:** `src` = direct `https://pub-*.r2.dev/previews/.../...-preview.{ext}` for canonical keys

### Albums / mixtapes / EPs

- **Card play:** `albumCardPlaybackItem` → first track → `resolvePlaybackSrc`
- **Tracklist:** `resolveAlbumTrackPlaybackItem` per row; canonical album tracks with `preview_legacy` → **B**; `enrichTrack` without legacy (folder only) → **A**

### Search

No separate resolver. Filtered subset of singles/albums using identical `CatalogGrid` / `LatestSinglesStyleRow` components.

### `resolve-playback-key.js`

**Entitled full master only** — orthogonal to preview CDN bypass.

### `stream-client.js`

Fetches `/api/library/stream` JSON + signed URL; `endStreamAnalytics` on entitled sessions only. **No preview API dependency.**

---

## Redirect elimination per surface (post-activation)

| Surface | Full API removal | Partial direct CDN | Status quo |
|---------|------------------|-------------------|------------|
| Canonical singles/features | ❌ | ✅ | Safe |
| Album card (track 0, keyed) | ❌ | ✅ | Safe |
| Album tracklist (all keyed tracks) | ❌ | ✅ | Safe |
| New upload (folder-only) | ❌ | ❌ Keep API | Required |
| Entitled stream | N/A | N/A | Unchanged |

---

## Coverage estimate

| Category | Direct CDN ready (B) | API required (A) |
|----------|----------------------|------------------|
| Canonical singles (4+) | ✅ `preview_legacy` | — |
| Canonical features (2+) | ✅ WAV keys | — |
| Canonical albums / EPs / mixtapes | ✅ when `preview_legacy` / track keys | Folder-only rows |
| DB-only future releases | — | Until concrete key |
| page.js flat `/audio/previews/` | ✅ after slug→canonical map | Until mapped |

**~90%+ visible storefront taps** → class **B** under partial activation (Phase 5.2.11 estimate confirmed).
