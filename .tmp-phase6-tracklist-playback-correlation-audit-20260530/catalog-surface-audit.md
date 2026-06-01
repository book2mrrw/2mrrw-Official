# Catalog Surface Audit — Playable Asset Validation

**Validation source:** `scripts/phase533-full-catalog-validation.mjs` (re-run 2026-05-31)  
**Flags (local only):** `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`  
**Artifacts:** `live-validation.json`, `post-remediation-validation.json`

---

## Summary by storefront surface

| Surface | Items | Stream registered | Resolver hit | Notes |
|---------|------:|------------------:|-------------:|-------|
| Latest Singles | 4 | 4/4 (100%) | 4/4 | `artificial`, `hour-glass`, `turnt-me-2-dis`, `w2d` |
| Features | 2 | 2/2 (100%) | 2/2 | `2-heavy`, `i-dont-believe-you` |
| Mixtapes & EPs (tracks) | 30 | 29/30 (96.7%) | 29/30 | 3 releases × 10/11/9 tracks |
| Albums (true albums) | 0 | — | — | `CANONICAL_TRUE_ALBUMS` empty |
| **Total playable catalog** | **36** | **35/36 (97.2%)** | **35/36** | |

R2 HEAD on registered keys: **35/35 exist** (100% of registered).

---

## Latest Singles

| Slug | Title | Stream key | Result |
|------|-------|------------|--------|
| artificial | ArTiFiCiAL | `streaming/singles/artificial/artificial_192.m4a` | PASS |
| hour-glass | Hour Glass | `streaming/singles/hour-glass/hour-glass_192.m4a` | PASS |
| turnt-me-2-dis | Turnt Me 2 Dis | `streaming/singles/turnt-me-2-dis/turnt-me-2-dis_192.m4a` | PASS |
| w2d | W.2.D | `streaming/singles/w2d/w2d_192.m4a` | PASS |

**Surface result: PASS**

---

## Features

| Slug | Title | Stream key | Result |
|------|-------|------------|--------|
| 2-heavy | 2 Heavy | `streaming/features/2-heavy/2-heavy_192.m4a` | PASS |
| i-dont-believe-you | I Don't Believe You | `streaming/features/i-dont-believe-you/i-dont-believe-you_192.m4a` | PASS |

**Surface result: PASS**

---

## Mixtapes & EPs — `ad` (11 tracks)

| Slug | Registered | Result |
|------|------------|--------|
| 01-2mrrws-ntro … 02-here-i-come, 05–07, 09–11 | yes | PASS |
| 03-said-n-done, 04-a-d-d, 08-life-changes-ft-gwendolyn | yes (post-533B) | PASS |
| All 11 | 11/11 | **PASS** |

---

## Mixtapes & EPs — `love-hz-vol-1` (10 tracks)

| Slug | Registered | Result |
|------|------------|--------|
| 02-w-2-d, 03–06, 07–10 | yes | PASS |
| 01-roll-call | **no** | **FAIL** — only gap in full catalog |

**Surface result: CONDITIONAL** (9/10 tracks)

---

## Mixtapes & EPs — `tbh` (9 tracks)

| Slug | Registered | Result |
|------|------------|--------|
| All except none | 9/9 | **PASS** |
| 03-unxpcted, 08-2late | remediated in 533B | PASS |

---

## Albums

No canonical true albums shipped. Storefront Albums section is empty by design — **N/A**.

---

## Tracklist vs catalog card playback

| Surface | Uses trackSlug? | Path-mismatch sensitive? |
|---------|-----------------|---------------------------|
| Single/Feature card | No (product slug only) | Only if product-level storage wrong (not seen) |
| Mixtape tracklist row | Yes | **Yes** for entitled stream (pre-533B) |
| Mixtape preview row | Yes (preview folder) | **Low** — separate `previews/` tree |

---

## Validation commands run

| Command | Result |
|---------|--------|
| `npm run build` | PASS |
| `npm run test:playback-resolver-fallback` | PASS (21/21) |
| `node scripts/phase533-full-catalog-validation.mjs` | PASS — 97.2% registration |
