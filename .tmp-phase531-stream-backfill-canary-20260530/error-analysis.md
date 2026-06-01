# Error Analysis — Phase 5.3.1

**Run date:** 2026-05-31  
**Section result:** **PASS** (expected errors only; one operational blocker)

---

## Backfill errors

| Error | Count | Entity | Mitigation |
|-------|-------|--------|------------|
| `stream_key must match …` (hyphen regex) | 1 (pre-fix) | hour-glass | Fixed validation regex before successful run |
| `master_not_found` | 1 | love-hz-vol-1/01-roll-call | Upload master to R2 or fix `storage_path` |
| Transcode/upload failures | 0 | — | — |

---

## Resolver fallback rates

| Scope | Stream hits | Fallbacks | Rate |
|-------|-------------|-----------|------|
| Canary set (8 items, flags ON) | 8 | 0 | **0% fallback** |
| Full catalog (36 candidates, flags ON) | 8 | 28 | **78% fallback** (`no_stream_registration`) |
| Pre-backfill (Phase 5.3) | 0 | all | ~100% fallback |

---

## Playback failures

**None observed** — stream miss → silent master fallback (Phase 5.2 design).

---

## Registration misses

**0** among successful backfills — all 8 rows have both `stream_path` and `stream_key`.

---

## Operational warnings

| Warning | Impact |
|---------|--------|
| ffmpeg not on PATH | Resolved via `ffmpeg-static` + `FFMPEG_PATH` |
| `--album-slug` processes all products first | Unintended 4 extra product backfills — document filter gap |
| `test:foundation` baseline drift | Pre-existing; unrelated to stream canary |

---

## Monitoring (staging next)

Watch `fallbacksByReason.no_stream_registration` until catalog backfill expands; target <10% after full backfill.
