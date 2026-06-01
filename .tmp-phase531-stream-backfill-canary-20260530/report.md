# Phase 5.3.1 — Stream Asset Backfill Canary

**Project:** artist-platform (2MRRW)  
**Run date:** 2026-05-31  
**Phase:** 5.3.1 — Stream Asset Backfill Canary  
**Scope:** Controlled canary — **no global production flags**

---

## Executive summary

First real stream inventory created: **8 AAC-LC 192 kbps +faststart** objects uploaded to R2 `streaming/` and registered in Supabase. With hybrid flags ON locally (`HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`), resolver returns **stream hits for all 8 backfilled items (100%)**. Entitled playback latency benefit is now **unblocked** for those items; catalog-wide benefit remains partial (8/36 candidates).

**Overall result: CONDITIONAL PASS**

| Audit | Result |
|-------|--------|
| Stream generation (AAC-LC 192k +faststart) | **PASS** — 8/9 targeted runs |
| DB registration (`stream_path`, `stream_key`) | **PASS** — 8 rows populated |
| R2 `streaming/` objects | **PASS** — HEAD confirms all 8 keys |
| Hybrid resolver stream hits (flags ON) | **PASS** — 8/8 canary hits |
| Collector / vault / download protection | **PASS** (code-path, unchanged) |
| Rollback (`STREAM_PLAYBACK_PREFERRED=0`) | **PASS** — 21/21 automated |
| Build | **PASS** |
| `test:playback-resolver-fallback` | **PASS** — 21/21 |
| `test:foundation` | **2 FAIL pre-existing** — baseline doc / anchor drift |
| Multi-track EP representative | **PARTIAL** — `love-hz-vol-1/01-roll-call` master missing |

---

## Canary inventory

| Category | Item | Status |
|----------|------|--------|
| Single | `hour-glass` | ✅ |
| Feature | `2-heavy` | ✅ |
| Mixtape track | `ad/01-2mrrws-ntro` | ✅ |
| Mixtape track | `tbh/01-glass-full` | ✅ |
| Multi-track EP | `love-hz-vol-1/01-roll-call` | ❌ `master_not_found` |

**Note:** Backfill CLI with `--album-slug` + `--slug` still enumerates **all unregistered products first**, producing 4 additional singles/features (`artificial`, `i-dont-believe-you`, `turnt-me-2-dis`, `w2d`). All 6 product rows are now stream-registered; 28/30 catalog tracks remain unbackfilled.

---

## Key metrics

| Metric | Value |
|--------|-------|
| Stream assets created | **8** |
| Resolver stream hits (canary set) | **8 / 8 (100%)** |
| Catalog registration rate | **8 / 36 (22%)** |
| Failed backfills | **1** (`master_not_found`) |
| Projected tap→audible delta (stream hit vs master) | **−200 to −600 ms [P]** |
| Measured stream object sizes | **4.4–5.9 MB** AAC vs **~30–80 MB [P]** WAV masters |

---

## Blockers resolved during run

1. **`stream_key` validation regex** rejected hyphenated slugs (e.g. `hour-glass_192.m4a`). Fixed in `stream-registration-validation.js` (`[a-z0-9-]+` filename segment).
2. **ffmpeg not on PATH** — used `ffmpeg-static` via `FFMPEG_PATH=node_modules/ffmpeg-static/ffmpeg`.

---

## Blockers remaining

1. **`love-hz-vol-1/01-roll-call`** — no resolvable master in R2 (`master_not_found`).
2. **Backfill CLI filter gap** — `--album-slug` does not suppress product candidates; use separate `--slug` runs or add filter before bulk canary.
3. **Staging entitled tap→audible** — not measured end-to-end in browser this run; latency section uses R2 HEAD + Phase 5.3 projection model.

---

## Validation commands

| Command | Result |
|---------|--------|
| `npm run backfill:stream-assets -- --yes --slug hour-glass` (+ targeted runs) | **PASS** — 8 ok, 1 fail |
| `node --import ./scripts/register-alias.mjs scripts/phase531-canary-validation.mjs` | **PASS** — 8/8 stream hits |
| `npm run build` | **PASS** |
| `npm run test:playback-resolver-fallback` | **PASS** — 21/21 |
| `npm run test:foundation` | **2 FAIL pre-existing** |

---

## Production safety

- **No Vercel production flags enabled.**
- Hybrid flags used **CLI-only** (`--yes`) and validation scripts — not committed to `.env`.
- Masters in `digital-assets/` untouched.

**STOP** — Phase 5.3.1 complete. Proceed to staging playback audit or limited catalog expansion only after operator review.
