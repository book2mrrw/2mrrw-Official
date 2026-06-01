# Coverage Delta — Phase 5.3.3 → 5.3.3B

**Validation script:** `scripts/phase533-full-catalog-validation.mjs`  
**Flags (local only):** `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`

## Summary

| Metric | Phase 5.3.3 (before) | Phase 5.3.3B (after) | Delta |
|--------|----------------------|----------------------|-------|
| Total playable assets | 36 | 36 | — |
| Stream assets in R2 | 26 | **35** | **+9** |
| DB registered (`stream_path` + `stream_key`) | 26 (72.2%) | **35 (97.2%)** | **+9 (+25.0 pp)** |
| R2 HEAD validation (registered keys) | 26/26 (100%) | **35/35 (100%)** | — |
| Resolver stream hits | 26 (72.2%) | **35 (97.2%)** | **+9 (+25.0 pp)** |
| Resolver fallbacks | 10 (27.8%) | **1 (2.8%)** | **−9 (−25.0 pp)** |

## Tracks remediated (9)

All previously `master_not_found` due to R2 slug/folder mismatch — now registered:

- ad/03-said-n-done, ad/04-a-d-d, ad/08-life-changes-ft-gwendolyn
- love-hz-vol-1/02-w-2-d, 07-stayed-2-long, 08-knock-on-wood, 09-hour-glass
- tbh/03-unxpcted, tbh/08-2late

## Remaining gap (1)

| Track | Status | Root cause |
|-------|--------|------------|
| love-hz-vol-1/01-roll-call | Unregistered, resolver fallback | `MASTER_ABSENT` — no WAV/FLAC/MP3 in R2 |

## Deployment readiness shift

| Gate | Before | After |
|------|--------|-------|
| `STREAM_PLAYBACK_PREFERRED=1` staging audit | Blocked (27.8% fallback) | **Near-ready** (2.8% fallback — single missing upload) |
| 100% catalog coverage | Blocked | **Blocked** — 1 track needs master upload |
