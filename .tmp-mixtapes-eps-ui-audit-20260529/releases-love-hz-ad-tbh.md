# Release audit — love-hz-vol-1, ad, tbh

Canonical source: `src/lib/media/canonical-catalog.js` + `canonical-paths.js`.  
Storefront UI source: `src/app/page.js` `INLINE_ALBUMS`.

---

## love-hz-vol-1 (EP)

| Field | Canonical | Storefront inline (`page.js`) | Gap |
|-------|-----------|-------------------------------|-----|
| Product slug | `love-hz-vol-1` | `love-hz` (alias resolves in `mergeCanonicalMetadata`) | Slug mismatch in cart/URL unless alias applied everywhere |
| Category | EP / `release_type: ep` | `type: "album"` | My Music cannot split to EPs section |
| Artwork folder | `images/mixtapes-and-eps/love-hz-vol-1/` | `/images/albums/lovehz.jpg` | Legacy path until R2 visual API used |
| Track count | 10 | 6 string titles | Modal/queue missing 4 tracks |
| Track slugs | `01-roll-call` … `10-turnt-me-2-dis` | title→slug via `titleToCatalogSlug` (fragile) | e.g. "All Of It" ≠ `04-all-love-it` |

### Canonical tracklist (order = `track_number`)

1. Roll Call — `01-roll-call`
2. W.2.D — `02-w-2-d`
3. Guarded Heart — `03-guarded-heart`
4. All Love It — `04-all-love-it`
5. Like U Do — `05-like-u-do`
6. Tell Me — `06-tell-me`
7. Stayed 2 Long — `07-stayed-2-long`
8. Knock On Wood — `08-knock-on-wood`
9. Hour Glass — `09-hour-glass`
10. Turnt Me 2 Dis — `10-turnt-me-2-dis`

### Audio / preview paths (per track)

- Full: `digital-assets/mixtapes-and-eps/love-hz-vol-1/{trackSlug}/`
- Preview: `previews/mixtapes-and-eps/love-hz-vol-1/{trackSlug}/`
- Filename inside folder: ignored (entity-resolver lists folder)

### Stream URL shape (entitled)

```
/api/library/stream?slug=love-hz-vol-1&trackSlug=01-roll-call&redirect=1
```

- `slug` = **release** product slug (not track slug as product)
- `trackSlug` query param required for track-level stream
- Resolved in `libraryStreamRedirectSrc` → `resolvePlaybackKey(admin, slug, { trackSlug })`

### Play path (UI)

1. Card click → `openAlbumModal` → `playAlbumTracks(album, 0)`
2. `albumTracksForPlayback` → `resolveAlbumTrackPlaybackItem` sets `slug: love-hz-vol-1` (or `love-hz` if not merged), `trackSlug` on metadata
3. `resolvePlaybackSrc` → stream URL with `trackSlug`

### Modal

- `AlbumModal` / `AlbumModalView` — track rows from `normalizeAlbumTracksForModal(selectedAlbum.tracks)`
- Inline strings only → modal shows wrong/missing titles; play index still maps via `titleToCatalogSlug` when possible

### Artwork API

`/api/media/visual?releaseType=mixtapes-and-eps&slug=love-hz-vol-1` (or `ep` alias) — validated in `.tmp-final-playback-validation-20260528`

---

## ad (Mixtape)

| Field | Canonical | Inline | Gap |
|-------|-----------|--------|-----|
| Slug | `ad` | `ad` | OK |
| Category | Mixtape | `type: "album"` | No Mixtapes My Music section |
| Tracks | 11 canonical slugs | 10 display strings | Missing "Here I Come" (`02-here-i-come`); title drift (Perspective vs Perspective (2018)) |

### Canonical tracklist

1. `01-2mrrws-ntro` — 2mrrw's Ntro  
2. `02-here-i-come` — Here I Come  
3. `03-said-n-done` — Said N' Done  
4. `04-a-d-d` — A.D.D  
5. `05-perspective` — Perspective  
6. `06-grand-scheme` — Grand Scheme  
7. `07-a2b` — A2B  
8. `08-life-changes-ft-gwendolyn` — Life Changes ft. Gwendolyn  
9. `09-itself` — Itself  
10. `10-wastin-time` — Wastin' Time  
11. `11-like-me-or-not` — Like Me or Not  

Paths: `digital-assets/mixtapes-and-eps/ad/{trackSlug}/`  
Stream example: `?slug=ad&trackSlug=01-2mrrws-ntro&redirect=1`

---

## tbh (Mixtape)

| Field | Canonical | Inline | Gap |
|-------|-----------|--------|-----|
| Slug | `tbh` | `tbh` | OK |
| Category | Mixtape | `type: "album"` | — |
| Tracks | 9 canonical | 8 strings | Missing `08-2late` (2Late?); spelling Unexpcted vs Unxpcted |

### Canonical tracklist

1. `01-glass-full` — Glass Full  
2. `02-up-2-me` — Up 2 Me  
3. `03-unxpcted` — Unxpcted  
4. `04-all-yours` — All Yours  
5. `05-locomotive` — Locomotive  
6. `06-left` — LEFT (interlude)  
7. `07-was-wrong` — Was Wrong  
8. `08-2late` — 2Late?  
9. `09-artificial` — ArTiFiCiAL  

Paths: `digital-assets/mixtapes-and-eps/tbh/{trackSlug}/`  
Stream example: `?slug=tbh&trackSlug=01-glass-full&redirect=1`

---

## Pipeline alignment summary

| Layer | mixtapes-and-eps ready? | UI uses it? |
|-------|-------------------------|-------------|
| `normalizeReleaseType(ep/mixtape)` | Yes → `mixtapes-and-eps` | Partially via `mergeCanonicalMetadata` on play |
| `resolveStoragePath` / preview paths | Yes | Yes when canonical track slug resolved |
| `resolve-playback-key` + stream route | Yes (`trackSlug` supported) | Yes for entitled stream |
| Storefront section split | N/A | **No** — still Albums + CatalogGrid |
| Tracklist UI | Canonical in DB/catalog module | **No** — inline string arrays |
| Singles-style cards + single modal | N/A for collections | **No** — album modal only |
