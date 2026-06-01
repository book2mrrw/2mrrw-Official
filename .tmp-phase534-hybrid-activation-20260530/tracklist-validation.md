# Tracklist Validation — Phase 5.3.4

**Run date:** 2026-05-31  
**Script:** `scripts/phase534-tracklist-validation.mjs`  
**Flags:** `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`

**Flow traced:** Track Selection → Queue → Asset → Stream → Playback Source → Start

---

## Latest Singles

| Slug | Queue | Asset | Stream key | Playback source | Result |
|------|-------|-------|------------|-----------------|--------|
| hour-glass | singles row | registered | `streaming/singles/hour-glass/hour-glass_192.m4a` | stream | **PASS** |
| artificial | singles row | registered | `streaming/singles/artificial/artificial_192.m4a` | stream | **PASS** |

**Controls:** play, pause, resume, next, previous — single `AudioContext` element; queue built from catalog slugs. No slug mismatch post-Phase 6.

---

## Features

| Slug | Queue | Asset | Stream key | Playback source | Result |
|------|-------|-------|------------|-----------------|--------|
| 2-heavy | features row | registered | `streaming/features/2-heavy/2-heavy_192.m4a` | stream | **PASS** |
| i-dont-believe-you | features row | registered | `streaming/features/i-dont-believe-you/i-dont-believe-you_192.m4a` | stream | **PASS** |

**Controls:** play, pause, resume — same queue/AudioContext path as singles.

---

## Mixtapes & EPs — ad (tracks 1, 3, 5, 7, last)

| # | Track slug | Stream key | Result |
|---|------------|------------|--------|
| 1 | 01-2mrrws-ntro | `streaming/mixtapes-and-eps/ad/01-2mrrws-ntro/01-2mrrws-ntro_192.m4a` | **PASS** |
| 3 | 03-said-n-done | `streaming/mixtapes-and-eps/ad/03-said-n-done/03-said-n-done_192.m4a` | **PASS** |
| 5 | 05-perspective | `streaming/mixtapes-and-eps/ad/05-perspective/05-perspective_192.m4a` | **PASS** |
| 7 | 07-a2b | `streaming/mixtapes-and-eps/ad/07-a2b/07-a2b_192.m4a` | **PASS** |
| 11 (last) | 11-like-me-or-not | `streaming/mixtapes-and-eps/ad/11-like-me-or-not/11-like-me-or-not_192.m4a` | **PASS** |

Entitled URL: `/api/library/stream?slug=ad&trackSlug={slug}&redirect=1`

---

## Mixtapes & EPs — love-hz-vol-1 (tracks 2, 5, 7, 9)

| # | Track slug | Stream key | Result |
|---|------------|------------|--------|
| 2 | 02-w-2-d | `streaming/mixtapes-and-eps/love-hz-vol-1/02-w-2-d/02-w-2-d_192.m4a` | **PASS** |
| 5 | 05-like-u-do | `streaming/mixtapes-and-eps/love-hz-vol-1/05-like-u-do/05-like-u-do_192.m4a` | **PASS** |
| 7 | 07-stayed-2-long | `streaming/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/07-stayed-2-long_192.m4a` | **PASS** |
| 9 | 09-hour-glass | `streaming/mixtapes-and-eps/love-hz-vol-1/09-hour-glass/09-hour-glass_192.m4a` | **PASS** |

**Not sampled:** track 1 (`01-roll-call`) — catalog fallback only (master absent).

---

## Mixtapes & EPs — tbh (tracks 3, 5, 8, last)

| # | Track slug | Stream key | Result |
|---|------------|------------|--------|
| 3 | 03-unxpcted | `streaming/mixtapes-and-eps/tbh/03-unxpcted/03-unxpcted_192.m4a` | **PASS** |
| 5 | 05-locomotive | `streaming/mixtapes-and-eps/tbh/05-locomotive/05-locomotive_192.m4a` | **PASS** |
| 8 | 08-2late | `streaming/mixtapes-and-eps/tbh/08-2late/08-2late_192.m4a` | **PASS** |
| 9 (last) | 09-artificial | `streaming/mixtapes-and-eps/tbh/09-artificial/09-artificial_192.m4a` | **PASS** |

---

## Summary

| Metric | Count |
|--------|------:|
| Samples tested | 17 |
| Stream hits | 17 |
| Master fallbacks | 0 |
| Failures | 0 |

**Verdict: PASS** for all requested sample tracks.
