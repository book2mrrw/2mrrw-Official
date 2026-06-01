# Playback Surface Audit — Phase 5.3.1

**Run date:** 2026-05-31  
**Section result:** **PASS** (code-path; staging browser audit recommended)

---

## Surfaces using entitled `/api/library/stream`

All surfaces route through `AudioContext` → `resolvePlaybackSrc` → library stream redirect → `resolvePlaybackKey` (server). With flags ON + registration, backfilled slugs resolve **stream** branch.

| Surface | Backfilled coverage | Expected behavior |
|---------|--------------------|--------------------|
| Latest Singles | hour-glass, turnt-me-2-dis, w2d, artificial | Stream hit when entitled |
| Featured | 2-heavy, i-dont-believe-you | Stream hit when entitled |
| Catalog Grid | All 6 products | Stream hit when entitled |
| Mixtapes/EPs (ad, tbh) | Tracks 01 only per album | Stream on backfilled track; master on others |
| Album tracklists | Partial (2/30 tracks) | Mixed stream/master within album |
| Queue / auto-advance | Same resolver | Stream when next item registered |
| Next / prev | Same resolver | Same |
| Resume | Offline master blob first | Unaffected |

---

## Guest preview path

**Unchanged** — hybrid flags do not affect preview CDN/direct preview.

---

## Recommended staging checks

1. Subscriber session on staging with flags ON
2. Play hour-glass from Latest Singles — Network shows stream key / smaller payload
3. Queue ad/01 then ad/02 — first stream, second master fallback
4. Toggle `STREAM_PLAYBACK_PREFERRED=0` — both master

---

## Media Session / lock screen

Metadata from track row unchanged; stream vs master transparent to Media Session API.

**Validation:** **PASS** (architecture unchanged from Phase 5.3)
