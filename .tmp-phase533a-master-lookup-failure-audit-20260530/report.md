# Phase 5.3.3A — Master Lookup Failure Audit

**Date:** 2026-05-31  
**Scope:** Read-only — no code, R2, backfill, or transcode changes  
**Hypothesis:** Phase 5.3.3 `master_not_found` reflects lookup/path mismatch, not absent masters.

## Executive summary

Live R2 probing (2026-05-31) confirms **9 of 10** failed tracks have WAV/FLAC/MP3 masters in R2 under **non-canonical folder names** relative to `catalog_tracks.storage_path`. Backfill resolves masters via `normalizeStoragePathForStorefront` → `resolveAudioFile` → **non-recursive** `discoverFileByExtensions` on the exact DB entity folder. When the R2 folder slug differs (trailing space, punctuation, spelling, track-number prefix, or `?`), discovery returns `null` and the pipeline reports `master_not_found` even though the asset exists nearby.

**One track** (`love-hz-vol-1/01-roll-call`) has **no audio object** under any probed `digital-assets/` prefix — consistent with prior validation and likely an intentional or known upload gap.

Phase 5.3.3’s failure analysis attributed all 10 to “masters absent in R2.” That conclusion is **incorrect for 9/10**; the pipeline and resolver behave as designed against **canonical** paths while R2 layout predates or diverges from canonical DB slugs.

## Root cause patterns (ranked)

| Pattern | Count | Description |
|---------|------:|-------------|
| **R2 folder slug ≠ DB `storage_path` segment** | 6 | Same track number, different folder string (spaces, dots, `?`, spelling). |
| **R2 track-number prefix ≠ DB track number** | 3 | love-hz-vol-1 tracks 7–9: files live under adjacent numeric folders. |
| **Master genuinely absent** | 1 | `01-roll-call` — no `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/` or alias hit. |

## Fix category summary (documentation only)

| Category | Tracks | Recommended direction |
|----------|--------|---------------------|
| **A — R2 rename/move to canonical folder** | 6 | Align object prefix to DB slug (preferred for long-term). |
| **B — DB `storage_path` / slug alignment** | 6 | Update `catalog_tracks` to match R2 if rename is unsafe. |
| **C — love-hz track re-index + R2 folder renumber** | 3 | Fix 07/08/09 numbering drift + missing `01`. |
| **D — Alias / fuzzy folder resolver (code)** | 9 | Optional hardening; not a substitute for canonical layout. |
| **E — Upload missing master** | 1 | `01-roll-call` only. |

## Evidence sources

- Backfill log: `.tmp-phase533-backfill-run.log`
- Checkpoint: `.backfill-stream-phase533.json`
- Code: `scripts/backfill-stream-assets.mjs`, `src/lib/media/stream-upload-pipeline.js`, `src/lib/media/entity-resolver.js`, `src/lib/storage/r2.js`, `src/lib/sync/normalize-storage-path.js`
- Live R2: read-only ListObjectsV2 + `resolveAudioFile` probe (2026-05-31T22:27Z)

## Outcome vs Phase 5.3.3

| Phase 5.3.3 claim | 5.3.3A finding |
|-----------------|----------------|
| 10× authoritative masters absent | **9× present under wrong folder keys** |
| Content ops blockers only | **9× path/slug alignment** (+ 1 upload) |
| Pipeline defect | **No** — non-recursive flat-folder discovery is working |

## Next phase (not executed here)

1. Canonical alignment workshop: per-track choose R2 rename vs DB update (see `recommended-fixes.md`).
2. Re-run `npm run backfill:stream-assets -- --yes --force` only after paths match.
3. Optional resolver alias map for legacy folders during migration window.
