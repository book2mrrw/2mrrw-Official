# Tracklist Validation — `ad` (2MRRW: (A.D))

**Release slug:** `ad`  
**Track count:** 11  
**Storefront section:** Mixtapes & EPs  
**Samples:** Track 1, 3, 5, 7, Last (11)

---

## Code path trace

| Step | Component | Behavior for `ad` |
|------|-----------|-------------------|
| Track metadata | `CANONICAL_TRACKS` + `getCanonicalTrack('ad', trackSlug)` | Titles, `storage_path`, `preview_path` per track |
| Tracklist UI | `AlbumTracklistSheet` → `albumTracksForPlayback` | Full 11-track list; Play All uses `playableReleaseQueue` (requires `src`) |
| Release mapping | `resolveAlbumTrackPlaybackItem` | `slug` = `ad` (release), `trackSlug` = e.g. `03-said-n-done` |
| Client playback URL | `resolvePlaybackSrc` → `libraryStreamRedirectSrc('ad', { trackSlug })` | `/api/library/stream?slug=ad&redirect=1&trackSlug=…` |
| Server resolution | `resolvePlaybackKey(admin, 'ad', { trackSlug })` | Loads `catalog_tracks.stream_key` when hybrid stream preferred |
| Preview fallback | `catalogPreviewAudioUrl(preview_path)` | `previews/mixtapes-and-eps/ad/{track}/` |

**page.js:** `playAlbumTracks` → `albumTracksForPlayback` → `playQueue` with `resolveReleaseQueueStartIndex` — no release-slug/trackSlug inversion observed.

---

## Per-track audit

### Track 1 — `01-2mrrws-ntro` (2mrrw's Ntro)

| Stage | Result |
|-------|--------|
| Track slug | `01-2mrrws-ntro` |
| Catalog resolution | Canonical track + storage_path `mixtapes-and-eps/ad/01-2mrrws-ntro/` |
| Master resolution | Not probed (stream-first); stream registered pre-remediation |
| Stream resolution | `streaming/mixtapes-and-eps/ad/01-2mrrws-ntro/01-2mrrws-ntro_192.m4a` |
| Entitled playback | **PASS** |
| Guest preview | **PASS** |

### Track 3 — `03-said-n-done` (Said N' Done) — **was path mismatch**

| Stage | Result |
|-------|--------|
| Track slug | `03-said-n-done` |
| Catalog resolution | Canonical slug matches DB |
| Master resolution (post-533B) | `digital-assets/mixtapes-and-eps/ad/03-said-n-done/Said N' Done (A.D).wav` |
| Pre-533B issue | R2 folder `03-said-n-done ` (trailing space) → `master_not_found` |
| Stream resolution (post-533B) | Registered `_192.m4a` — resolver hit |
| Entitled playback | **PASS** (was **FAIL** pre-remediation) |
| Guest preview | **PASS** |

### Track 5 — `05-perspective`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

### Track 7 — `07-a2b`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

### Track 11 (last) — `11-like-me-or-not`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

---

## Release-level result

| Audience | Result | Notes |
|----------|--------|-------|
| Entitled tracklist (sampled) | **PASS** | All 5 samples stream-resolve |
| Guest tracklist (sampled) | **PASS** | Preview paths intact |
| Correlation | Remediated tracks 3 (and 4, 8 not sampled) were path-mismatch failures; fixed in 533B |

**Non-sampled remediated tracks on this release:** `04-a-d-d`, `08-life-changes-ft-gwendolyn` — catalog validation **PASS** post-533B.
