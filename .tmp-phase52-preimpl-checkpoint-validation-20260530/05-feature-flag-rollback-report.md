# 05 — Feature Flag Rollback Report

**Phase:** 5.2 Pre-Implementation Checkpoint Validation  
**Date:** 2026-05-30  
**Mode:** Read-only audit — Phase 5.2 not implemented

---

## Verdict: **CONDITIONAL PASS**

Planned Phase 5.2 feature flags **do not exist in source code yet**. Current codebase is inherently **master-only** — equivalent to `STREAM_PLAYBACK_PREFERRED=0`. Rollback **design** from Phase 5 / 5.1 is validated; runtime flag infrastructure is **not implemented**.

---

## Flag existence audit

| Flag | In `src/`? | In `.env.example`? | In Vercel config? |
|------|------------|--------------------|--------------------|
| `HYBRID_STREAMING_ENABLED` | ❌ Not found | ❌ | ❌ |
| `STREAM_PLAYBACK_PREFERRED` | ❌ Not found | ❌ | ❌ (design doc only) |
| `AUTO_GENERATE_STREAM_ASSETS` | ❌ Not found | ❌ | ❌ |

**Related env vars present today:**

| Var | Location | Purpose |
|-----|----------|---------|
| `R2_STREAM_DEBUG=1` | `library/stream/route.js`, server-timing | Debug only |
| `NEXT_PUBLIC_DEBUG_PLAYBACK_EVENTS=1` | control-system playback | Diagnostics |

These are unrelated to hybrid streaming rollout.

---

## Planned rollback design (Phase 5 / 5.1)

Sources:

- `.tmp-phase5-hybrid-architecture-20260530/08-rollback-plan.md`
- `.tmp-phase51-readiness-validation-20260530/09-rollback-plan.md`

| Control | Action | Effect | Time |
|---------|--------|--------|------|
| `STREAM_PLAYBACK_PREFERRED=0` | Vercel env | Skip stream discovery; master-only | <5 min |
| `STREAM_PLAYBACK_SLUG_DENYLIST` | Per-slug env | Master fallback for bad transcodes | <5 min |
| `HYBRID_STREAMING_ENABLED=0` | Global kill (planned) | Disable hybrid code paths | Design only |
| `AUTO_GENERATE_STREAM_ASSETS=0` | Ingest gate (planned) | Stop transcode uploads | Design only |
| Git revert + redeploy | Resolver rollback | Same as flag off if flags absent | ~10 min |
| Cache clear | `clearPlaybackKeyCache()`, stream-url-cache TTL ≤55m | Cold resolve picks master | Post-deploy |

**Data rollback:** Not required — masters preserved; orphaned `streaming/` objects harmless when flags off.

---

## `STREAM_PLAYBACK_PREFERRED=0` → master playback

| Check | Status |
|-------|--------|
| Design documented | ✅ Phase 5.1 §09 |
| Resolver extension point | ✅ `resolve-playback-key.js` — stream-first to be added behind flag |
| Master fallback path | ✅ Current code is 100% master |
| Client contract unchanged | ✅ `libraryStreamRedirectSrc`, single `<audio>` |
| Download token isolated | ✅ `/api/access/[token]` uses master `storage_path` only |

**Today:** Setting `STREAM_PLAYBACK_PREFERRED=0` would be a no-op (flag unread). **Effective behavior is already master playback.**

---

## Safe disable without flags?

| Mechanism | Works today? |
|-----------|--------------|
| Env flag off | N/A — no flag reader |
| Remove stream code | N/A — no stream code |
| Default code path | ✅ Master-only resolver |
| Phase 4.8 caches independent | ✅ Preview fast path separate from hybrid |

**Pre-implementation safety:** ✅ Cannot accidentally enable streaming — not built.

**Post-implementation requirement:** Flags must be implemented **before** prod canary per Phase 5.1 hold on 5d.

---

## Implementation gates from Phase 5.1

| Gate | Status |
|------|--------|
| Flag-gated resolver before prod | ⏸ Required |
| Rollback drill in staging | ⏸ Pending implementation |
| `normalizePlaybackR2Key` streaming awareness | ⏸ Not implemented |

---

## Gaps

1. No flag parsing utility or central feature-flag module for hybrid streaming
2. No `STREAM_PLAYBACK_PREFERRED` check in `resolve-playback-key.js`
3. No Vercel env documentation in `.env.example`
4. `HYBRID_STREAMING_ENABLED` / `AUTO_GENERATE_STREAM_ASSETS` not specified in code paths yet

---

## Layer conclusion

| Criterion | Result |
|-----------|--------|
| Flags exist in codebase | ❌ (expected pre-5.2) |
| Rollback design validated | ✅ |
| Current default = master-only | ✅ |
| Safe disable path when implemented | ✅ (design) |
| Rollback drill executable | ❌ (flags not built) |

**Feature Flag Rollback Validation: CONDITIONAL PASS**

*Condition: Design approved; implementation of flag readers required as first 5.2 task before prod canary.*
