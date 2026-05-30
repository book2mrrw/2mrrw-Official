# Phase 5.2 — Stage 6: Catalog Backfill Tooling

**Date:** 2026-05-30  
**Phase:** HYBRID MASTER / STREAM IMPLEMENTATION — Stage 6 only  
**Repository:** `/Users/recharge/artist-platform`  
**Recovery anchor:** `bac9eb71f93dcbc0bee4099bf6d80ddaac29e049` (`bac9eb7`) — unchanged

---

## Executive summary

Stage 6 adds an **optional, resumable, non-destructive** CLI backfill for generating stream renditions on existing catalog rows that have masters but no stream registration. The tool reuses the Stage 3 `stream-upload-pipeline.js` transcode → R2 upload → DB registration flow.

**Default platform behavior unchanged** — flags remain OFF in env; script is manual-only and never auto-runs on deploy or startup.

---

## Files modified / created

| File | Action | Purpose |
|------|--------|---------|
| `scripts/backfill-stream-assets.mjs` | **Created** | Resumable CLI backfill with dry-run, gate, checkpoint |
| `src/lib/media/stream-upload-pipeline.js` | **Modified** | Added `persistStreamRegistrationForCatalogTrack`, `generateStreamAssetForCatalogTrack` |
| `package.json` | **Modified** | Added `npm run backfill:stream-assets` |
| `.tmp-phase52-stage6-backfill-20260530/backfill-usage.md` | **Created** | Operator usage guide |
| `.tmp-phase52-implementation-20260530/report.md` | **Updated** | Stage 6 complete; Stage 7 blocked |

**Not modified (prohibited):** `AudioContext.js`, `/api/library/stream` behavior, entitlements, audiovisual, recovery anchor, production env flags.

---

## Backfill usage

```bash
# Safe enumeration (no transcode)
npm run backfill:stream-assets -- --yes --dry-run

# Live run (requires ffmpeg + stream migration applied)
HYBRID_STREAMING_ENABLED=1 AUTO_GENERATE_STREAM_ASSETS=1 \
  npm run backfill:stream-assets -- --limit 10
```

See `.tmp-phase52-stage6-backfill-20260530/backfill-usage.md` for full options.

---

## Resume behavior

- Checkpoint: `.backfill-stream-checkpoint.json` (configurable via `--checkpoint`)
- Completed slugs skipped on re-run
- `--force` bypasses skip for items with existing stream registration
- Per-item failures recorded in `failed[]`; script continues

---

## Failure handling

| Behavior | Detail |
|----------|--------|
| Continue on failure | Yes — one bad item does not abort the queue |
| Exit code | `1` if any failures in current run |
| Master safety | Masters in `digital-assets/` are read-only; never deleted or overwritten |
| ffmpeg absent | Live runs warn and fail per-item; `--dry-run` unaffected |
| Pre-migration DB | Dry-run falls back to metadata-only stream detection if columns missing |

---

## Rollback

1. **Do not run the backfill script.**
2. Set hybrid streaming env flags to `0` — playback uses master fallback (Stage 4/5).
3. Optionally remove `streaming/` R2 objects and null stream columns (manual ops).
4. Delete checkpoint file to reset backfill progress.

No recovery anchor changes required.

---

## Validation results

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run test:foundation` | **PASS** |
| `npm run verify:foundation -- --quick` | **PASS** |
| `npm run backfill:stream-assets -- --yes --dry-run` | **PASS** (36 candidates: 6 products + 30 tracks) |

---

## STOP — awaiting Stage 7 approval

Stage 7 (staging canary / end-to-end validation / prod rollout) is **not** in scope. Do not enable production flags or run live backfill at scale without operator approval.
