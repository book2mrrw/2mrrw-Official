# Phase 5.1 — Hybrid Master / Stream Architecture Readiness + Migration Validation

**Date:** 2026-05-30  
**Repo:** `/Users/recharge/artist-platform`  
**Mode:** Analysis only — **zero source modifications confirmed**  
**Inputs:** Phase 5 design (`.tmp-phase5-hybrid-architecture-20260530/`), Phase 4.5–4.8 audits, canonical catalog + resolver code review  
**Zip:** `/Users/recharge/Downloads/phase51-readiness-validation-20260530.zip`

---

## Executive summary

2MRRW today uses **one physical asset class** — WAV/FLAC/MP3 masters in R2 `digital-assets/` entity folders — for both archival ownership and in-browser playback via a same-origin signed proxy (`/api/library/stream?redirect=1`). Previews are a separate public layer under `previews/`. Phases 4.5–4.8 proved the **client fast path is sound**; remaining tap→audible delay is dominated by **large master byte weight** and **CDN first-byte** (~954 ms measured for 64 KiB preview range).

Phase 5 proposes a **hybrid architecture**: masters stay authoritative for collector/download; **AAC-LC stream renditions** live under a new `streaming/` prefix keyed by the same entity-folder identity; playback resolves stream-first with master fallback.

**This Phase 5.1 audit validates** that the design is compatible with the as-built codebase, migration can be zero-downtime, collector/download paths remain isolated, and rollback is env-flag trivial. **Gaps:** no transcode pipeline, no live R2 inventory, entitled 200 stream not measured in prod.

---

## Readiness score

| Dimension | Score |
|-----------|------:|
| Architecture | 88 |
| Migration | 74 |
| Playback | 86 |
| Operational | 71 |
| **Total** | **81 / 100** |

See `12-readiness-score.md` for methodology and gates.

---

## Final recommendation

### **Conditional GO**

| Phase | Verdict |
|-------|---------|
| **5b — Ingest** (transcode + R2 `streaming/`) | ✅ **Proceed** |
| **5c — Resolver** (stream-first + feature flag) | ✅ **Proceed** |
| **5d — Prod canary** | ⏸ **Hold** until ≥95% backfill + staging HAR + QA matrix |

**One-liner:** Approve hybrid implementation with flag-gated rollout; do not flip production until transcode backfill and staging entitled-play validation complete. Masters and download tokens must never regress.

---

## Key findings

### Validated ✅

- Entity folder layout in `canonical-paths.js` supports mirrored `streaming/` paths
- `resolvePlaybackKey` extension point clear; master fallback preserves uptime
- Client contract unchanged (`libraryStreamRedirectSrc`, `redirect=1`, single `<audio>`)
- Download token (`api/access/[token]`) isolated from playback resolver — master-only
- Phase 4.8 caches and Server-Timing compatible with key-only change
- Rollback via `STREAM_PLAYBACK_PREFERRED=0` — no data restore

### Gaps ⚠️

- `normalizePlaybackR2Key` not yet `streaming/`-aware (implementation required)
- No transcode worker or `streaming/` objects in bucket
- R2 format/size inventory **estimated** from 36 catalog entities — not measured
- Stream URL cache should hash resolved key to prevent stale presign
- Entitled 200 stream TTFB + iOS tap→audible still **pending** (Phase 4.7)

### Measured vs estimated

| Finding | Type |
|---------|------|
| 36 master audio entity folders (catalog) | **Exact** (code) |
| ~1.27 GB masters, +118 MB streams | **Estimated** |
| −91% play egress with AAC | **Estimated** (arithmetic) |
| CDN preview range TTFB 954 ms | **Measured** (Phase 4.7) |
| Preview API 602→4 ms warm | **Measured** (Phase 4.8) |
| Stream redirect 279–804 ms prod / 3–9 ms warm | **Measured** (Phase 4.7–4.8) |

---

## Catalog snapshot

| Type | Releases | Tracks / entities |
|------|----------|------------------:|
| Singles | 4 | 4 |
| Features | 2 | 2 |
| Mixtapes & EPs | 3 | 30 tracks |
| **Total playable entities** | **9 releases** | **36** |

Detail: `01-media-inventory.md`

---

## Architecture decision confirmation

| Option | Verdict |
|--------|---------|
| Hybrid master + stream renditions | **Adopt** |
| Transcode on every play | Reject |
| Replace masters with MP3 only | Reject |
| Public unauthenticated `streaming/` | Reject |

---

## Deliverables index

See `manifest.txt`. Deep dives: `01`–`12`.

---

## Next steps (implementation — out of 5.1 scope)

1. Provision FFmpeg transcode batch + R2 inventory script
2. Backfill `streaming/…/*.m4a` for 36 entity folders (P0 slugs first)
3. Implement stream-first `resolvePlaybackKey` behind `STREAM_PLAYBACK_PREFERRED`
4. Staging validation: entitled 200 + download token master check + iOS timing
5. Prod canary on allowlist slugs after gates in `12-readiness-score.md`

---

## Zero modification confirmation

```
git status --short src/
(empty — no files modified)
```

Analysis artifacts written only to `.tmp-phase51-readiness-validation-20260530/`.
