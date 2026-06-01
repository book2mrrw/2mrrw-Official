# Tracklist Validation — `love-hz-vol-1` (Love Hz Vol. 1)

**Release slug:** `love-hz-vol-1` (alias `love-hz` → canonical)  
**Track count:** 10  
**Storefront section:** Mixtapes & EPs  
**Samples:** Track 1, 3, 5, 7, Last (10)

---

## Code path trace

Same pipeline as `ad` — `AlbumTracklistSheet` / `albumTracksForPlayback` / `resolvePlaybackKey(admin, 'love-hz-vol-1', { trackSlug })`.

Slug alias `love-hz` maps to `love-hz-vol-1` in `CANONICAL_SLUG_ALIASES` — does not affect stream API when modal uses canonical album object.

---

## Per-track audit

### Track 1 — `01-roll-call` (Roll Call) — **BLOCKER**

| Stage | Result |
|-------|--------|
| Track slug | `01-roll-call` |
| Catalog resolution | Canonical track present; `storage_path` `mixtapes-and-eps/love-hz-vol-1/01-roll-call/` |
| Master resolution | **FAIL** — `resolved_master_key: null` (no WAV/FLAC/MP3 in R2) |
| Stream resolution | **FAIL** — `no_stream_registration` |
| Server `resolvePlaybackKey` | **FAIL** — returns `null` |
| Client entitled row | Shows `ready` + stream URL (optimistic) — **playback will fail at API** |
| Guest preview | **PASS** — preview folder exists |
| Correlation | **Not** a 533A path mismatch — missing upload |

### Track 3 — `03-guarded-heart`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

### Track 5 — `05-like-u-do`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

### Track 7 — `07-stayed-2-long` — **was path mismatch (wrong folder `09-stayed-2-long`)**

| Stage | Result |
|-------|--------|
| Master (post-533B) | Under canonical `07-stayed-2-long/` |
| Stream | **PASS** |
| Pre-533B | **FAIL** — off-by-one R2 folder |
| Guest preview | **PASS** |

### Track 10 (last) — `10-turnt-me-2-dis`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

---

## Remediated but not in sample set

| Track | Pre-533B issue | Post-533B |
|-------|----------------|-----------|
| `02-w-2-d` | R2 `02-w2d` | **PASS** |
| `08-knock-on-wood` | R2 `07-knock-on-wood` | **PASS** |
| `09-hour-glass` | R2 `08-hour-glass` | **PASS** |

---

## Release-level result

| Audience | Result | Notes |
|----------|--------|-------|
| Entitled tracklist (sampled) | **CONDITIONAL** — 4/5 PASS; track 1 FAIL |
| Guest tracklist (sampled) | **PASS** |
| User-reported inconsistency | Explained: mix of **remediated path failures** (now fixed) + **track 1 absent master** (still open) |

Play All for entitled users may still attempt track 1 (has client `src`) then error on stream API — perceived as “random” skip/fail in queue.
