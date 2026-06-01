# Phase 5.3 — Hybrid Streaming Canary Activation

**Project:** artist-platform (2MRRW)  
**Run date:** 2026-05-31  
**Phase:** 5.3 — Hybrid Streaming Canary Activation  
**Scope:** Controlled canary validation — **no global production rollout**

---

## Executive summary

Hybrid streaming scaffolding (Phase 5.2 stages 1–7) is **code-ready for staging canary** with env-only activation. All automated validation passes (build, 21/21 resolver fallback tests). Supabase migration `20260530160000_stream_asset_registration.sql` is **applied** — `stream_path` / `stream_key` columns exist on `products` and `catalog_tracks`.

**Blocker for latency benefit:** Zero stream assets registered in DB and zero `streaming/` objects in R2 (404 on probe). Enabling flags ON today is **safe** (master fallback) but delivers **no entitled playback latency improvement** until backfill completes.

Direct preview flags (`DIRECT_PREVIEW_ENABLED`, `NEXT_PUBLIC_DIRECT_PREVIEW_CDN`) are **orthogonal** — recommend **OFF** for hybrid-only canary to isolate entitled-path measurement.

---

## Overall result: **CONDITIONAL PASS**

| Audit | Result |
|-------|--------|
| Feature flags + resolver wiring | **PASS** |
| Asset resolution (Guest→Preview, Entitled→Stream/Master) | **PASS** (code-path) |
| Collector protection (offline master, vault) | **PASS** |
| Queue / auto-advance / resume | **PASS** |
| Media Session | **PASS** |
| Rollback (env toggle → master) | **PASS** |
| Fallback matrix (21 scenarios) | **PASS** |
| Error analysis | **PASS** |
| Build | **PASS** |
| Entitled hybrid latency (measured) | **BLOCKED** — no stream assets |
| Stream asset backfill | **PENDING** — 36 candidates, 0 registered |
| `test:foundation` | **2 FAIL pre-existing** — baseline doc / anchor drift |

---

## Validation commands

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** |
| `npm run test:playback-resolver-fallback` (flags OFF) | **PASS** (21/21) |
| `npm run test:playback-resolver-fallback` (flags ON) | **PASS** (21/21) |
| `npm run backfill:stream-assets -- --dry-run --limit 3` | **PASS** — 36 candidates, migration columns OK |
| Supabase column probe (`stream_path`, `stream_key`) | **PASS** — columns exist, all null |
| R2 `streaming/` HEAD probe | **404** — no AAC assets yet |
| `npm run test:foundation` | **2 FAIL pre-existing** |

---

## Canary configuration (local / staging only)

```bash
# Hybrid streaming (entitled path)
HYBRID_STREAMING_ENABLED=1
STREAM_PLAYBACK_PREFERRED=1
AUTO_GENERATE_STREAM_ASSETS=1   # optional for canary; use backfill CLI first

# Direct preview — keep OFF for hybrid-only canary
DIRECT_PREVIEW_ENABLED=0
NEXT_PUBLIC_DIRECT_PREVIEW_CDN=0
```

**Rollback:** set hybrid flags to `0` or unset — master playback restored (21 automated scenarios).

**Do NOT enable in Vercel production globally.**

---

## Latency delta (summary)

| Path | Before (master-only entitled) | After hybrid (stream hit, projected) | Current (flags ON, no assets) |
|------|------------------------------|----------------------------------------|-------------------------------|
| API + first byte | **250–730 ms** | **80–250 ms [P]** | **250–730 ms** (master fallback) |
| Resolver overhead | 0 ms | **+5–30 ms** R2 HEAD | **+5–30 ms** then fallback |
| Tap→audible (est.) | **400–1200 ms** | **200–600 ms [P]** | Unchanged vs master |

See `latency-comparison.md` for methodology and probes.

---

## Deployment readiness

| Environment | Recommendation |
|-------------|----------------|
| **Local dev** | **OK** — enable flags after limited backfill (`--limit 3`) |
| **Staging canary** | **CONDITIONAL OK** — sequence: (1) backfill, (2) enable flags, (3) device QA 24–48 h |
| **Production global** | **NO** — await staging canary + stream hit rate monitoring |

---

## Blockers

1. **Stream assets:** 36 backfill candidates; 0 with `stream_key` in DB; R2 `streaming/` 404
2. **ffmpeg:** Required on backfill host (not Vercel serverless)
3. **Entitled latency measurement:** Requires subscriber session + post-backfill staging run
4. **Mobile Safari QA:** Tap→audible, lock screen, queue auto-advance with stream AAC

---

## Pre-existing drift (non-blocking)

- `test:foundation`: HEAD not in baseline doc; recovery tag ≠ HEAD
- Not introduced by hybrid streaming work

---

## Deliverables

| File | Description |
|------|-------------|
| `report.md` | This document |
| `activation-summary.md` | Flag activation + operator sequence |
| `latency-comparison.md` | Before/after entitled playback timing |
| `fallback-analysis.md` | Resolver fallback matrix |
| `collector-validation.md` | Downloads, vault, ownership, masters |
| `entitlement-validation.md` | Guest→Preview, Entitled→Stream matrix |
| `rollback-validation.md` | Env toggle proof |
| `error-analysis.md` | Miss rates, failure paths |
| `playback-surface-audit.md` | All playback surfaces |
| `bottleneck-ranking.md` | Post-hybrid TOP 3 |
| `manifest.txt` | File manifest |

---

## Success criteria

| Criterion | Met? |
|-----------|------|
| Hybrid flags activate resolver stream branch | ✅ Code + tests |
| Master fallback on stream miss | ✅ 21/21 |
| No guest preview leakage | ✅ 5.2.14 PASS |
| Collector offline master priority | ✅ Code-path |
| Rollback verified | ✅ Env-only |
| Measurable entitled latency improvement | ⏳ Blocked — no stream assets |
| Staging canary ready | ⏳ After backfill |

**Phase 5.3 complete. STOP — await backfill + staging canary before prod.**
