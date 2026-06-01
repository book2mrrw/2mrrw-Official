# Resolver Hit Analysis — Phase 5.3.1

**Run date:** 2026-05-31  
**Flags (validation only):** `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`  
**Section result:** **PASS**

---

## Summary

| Metric | Value |
|--------|-------|
| Canary items tested | 8 |
| Stream resolver hits | **8** |
| Master fallbacks (canary set) | **0** |
| Stream hit rate (canary) | **100%** |
| Catalog-wide hit rate (if all entitled played now) | **22%** (8/36 with storage_path) |

---

## Per-item results

| ID | Registered | Resolver | Key returned | Fallback reason |
|----|------------|----------|--------------|-----------------|
| product:hour-glass | ✅ | **stream** | `streaming/singles/hour-glass/hour-glass_192.m4a` | — |
| product:2-heavy | ✅ | **stream** | `streaming/features/2-heavy/2-heavy_192.m4a` | — |
| product:artificial | ✅ | **stream** | `streaming/singles/artificial/artificial_192.m4a` | — |
| product:i-dont-believe-you | ✅ | **stream** | `streaming/features/i-dont-believe-you/…` | — |
| product:turnt-me-2-dis | ✅ | **stream** | `streaming/singles/turnt-me-2-dis/…` | — |
| product:w2d | ✅ | **stream** | `streaming/singles/w2d/w2d_192.m4a` | — |
| track:ad/01-2mrrws-ntro | ✅ | **stream** | `streaming/mixtapes-and-eps/ad/01-2mrrws-ntro/…` | — |
| track:tbh/01-glass-full | ✅ | **stream** | `streaming/mixtapes-and-eps/tbh/01-glass-full/…` | — |

---

## Resolution path

1. `tryResolveStreamPlaybackKey` — flags ON
2. `pickRegisteredStreamFields` — products columns or `catalog_tracks` via `loadTrackStreamFields(albumSlug, trackSlug)`
3. `validateRegisteredStreamFields` — canonical key/path
4. R2 HEAD — object exists → stream key returned

---

## Non-backfilled items (expected fallback)

Any entitled play for unregistered slug/track → `no_stream_registration` → master fallback (proven in Phase 5.3 matrix).

Example: `love-hz-vol-1/01-roll-call` → master (no stream_key).

---

## Automated regression

`npm run test:playback-resolver-fallback` — **21/21 PASS** (includes stream-hit and master-fallback scenarios).
