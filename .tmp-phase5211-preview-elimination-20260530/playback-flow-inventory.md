# Playback Flow Inventory — Preview API vs Direct CDN

**Resolver funnel:** All guest preview URLs originate from `catalogPreviewAudioUrl()` in `src/lib/media-urls.js`.  
**Current state:** **100% of catalog discovery previews** use `/api/media/preview` (via `previewDiscoveryUrl`).  
**Direct CDN today:** Only when `catalogPreviewAudioUrl` falls through to `catalogPublicMediaUrl` (non-folder, non-legacy patterns — rare in production catalog).

---

## Surface matrix

| Surface | Component / entry | Preview path | Entitled path | Uses preview API? |
|---------|-------------------|--------------|---------------|-------------------|
| **Home — Latest Singles row** | `LatestSinglesStyleRow` → `ReleaseCardPlayButton` → `playTrack` | `preview_path` / `preview` | `library/stream?redirect=1` if owned/sub/collector | ✅ Guest |
| **Home — carousel / hero singles** | `page.js` `playCanonicalCatalogItem` | Same | Same | ✅ Guest |
| **Home — Features row** | `LatestSinglesStyleRow` (cover cards) | Folder `previews/features/{slug}/` | Same | ✅ Guest |
| **Features modal** | `ImmersivePreviewModal` → `page.js` modal open → `playCanonicalCatalogItem(..., "feature_modal")` | Same | Same | ✅ Guest |
| **Singles preview modal** | `ImmersivePreviewModal` → `"preview_modal"` | Same | Same | ✅ Guest |
| **Albums grid** | `CatalogGrid` → `albumCardPlaybackItem` → first track | Album/track preview_path | Stream with album slug + trackSlug | ✅ Guest |
| **Album modal** | `AlbumModal` / `playAlbumTracks` | Per-track preview | Queue of stream URLs | ✅ Guest (per track) |
| **Mixtapes / EPs** | Same grid/row patterns | `previews/mixtapes-and-eps/…` | Same as albums | ✅ Guest |
| **Search (Music tab)** | Client filter on singles list — same card components | Same cards | Same | ✅ Guest (filtered UI only) |
| **Library / My Music** | `MyMusicTab.playItem` | N/A — `canStream` required | `/api/library/stream` | ❌ Entitled only |
| **Playlists** | `MyMusicTab.playPlaylist` | Fallback if no stream | `toPlaybackTrack` → stream | ❌ Usually entitled |
| **Collector card owner** | Same as subscriber/owner | N/A when entitled | Stream | ❌ When entitled |
| **Guest / discovery tier** | Any card with `access.canPreview` | Preview API | — | ✅ |
| **Admin** | `adminTrackAccess` | Stream (full) | Stream | ❌ |
| **Card prewarm** | `usePlaybackCardPrewarm` / `playback-prewarm-cache` | Stores `previewSrc` = API URL | Stores `streamPath` | ✅ Descriptor |
| **Continue listening** | `ContinueListening` | If guest | `resolvePlaybackSrc` | ✅ Guest |
| **Deep link** | `DeepLinkRedirect` | Via normalized track | Stream if entitled | Mixed |
| **Vault** | Separate `/api/vault/media` | Vault preview storage | Signed/gated | ❌ Not preview API |

---

## Code path detail by scenario

### Singles (guest)

1. `page.js` legacy data: `preview: "/audio/previews/hourglass-preview.mp3"`
2. `withR2CatalogMedia` → `catalogPreviewAudioUrl` → API URL
3. `normalizeTrackForPlayback` → `resolvePlaybackSrc` → same API URL (guest)
4. `AudioContext` sets `audio.src` → GET API → 302 → CDN

### Features (guest)

1. `preview: "previews/features/i-dont-believe-you/"` (folder)
2. `catalogPreviewAudioUrl` → API with legacy WAV candidate
3. Same redirect chain

### Albums / mixtapes / EPs (guest, inline play)

1. `albumCardPlaybackItem` → first track via `resolveAlbumTrackPlaybackItem`
2. Preview from track or album `preview_path`
3. API discovery → CDN

### Album modal (multi-track)

1. `albumTracksForPlayback` → each track `normalizeTrackForPlayback`
2. Guest queue: each `src` = preview API URL
3. Entitled queue: each `src` = library stream redirect

### Search

- `page.js` ~L2195: `<input placeholder="Search singles…">` — **UI filter only**, no separate resolver
- Play uses same `CatalogGrid` / row components → preview API

### Library / collector (entitled)

1. `resolveTrackAccess` → `canStream=true`
2. `resolvePlaybackSrc` → `libraryStreamRedirectSrc(slug, { trackSlug })`
3. **Does not call preview API** for primary playback
4. `AudioContext`: if stream fails 401/403, falls back to `getTrackPreviewSrc` → **preview API**

---

## ImmersivePreviewModal role

- **Does not own audio** — modal UI only (`access` prop: `"preview"` vs `"full"`)
- Playback triggered by parent `page.js` via `playCanonicalCatalogItem` on modal open
- No direct `/api/media/preview` reference in modal file

---

## `resolve-playback-key.js` vs preview API

| | Preview API | resolvePlaybackKey |
|--|-------------|-------------------|
| **Purpose** | Public preview file discovery | Entitled full audio key |
| **Auth** | None | Server-side (library/stream route) |
| **Output** | 302 public CDN | R2 key → signed URL |
| **Used by guest preview** | ✅ | ❌ |

---

## Redirect elimination per scenario

| Scenario | Full bypass | Partial bypass | Resolver-only |
|----------|-------------|----------------|---------------|
| Canonical single tap | ✅ Embed CDN key | ✅ | Cached 302 |
| Feature (WAV) | ✅ With correct ext | ✅ | Cached 302 |
| Album first-track card | ✅ If track key known | ✅ | Cached 302 |
| Album modal track N | ⚠️ Needs per-track keys | ✅ canonical tracks | API per track |
| Legacy page.js flat path | ⚠️ Must map to nested key | ✅ via canonical | API |
| New release (folder only) | ❌ | ❌ Keep API | API |
| Entitled stream | N/A | N/A | N/A |
| Stream 401 fallback | ✅ Same preview CDN | ✅ | API today |

---

## Coverage estimate (storefront)

| Category | Count (canonical) | Direct CDN ready? |
|----------|-------------------|-------------------|
| Singles | 4+ | ✅ `preview_legacy` defined |
| Features | 2+ | ✅ WAV keys defined |
| Albums / EPs / mixtapes | Per release | ✅ if `preview_legacy` / track keys present |
| DB-only future releases | Unknown | ❌ until keyed |

**~90%+ of visible storefront taps** hit canonical releases with known `preview_legacy` — partial bypass covers majority of guest latency pain.
