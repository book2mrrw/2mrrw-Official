# Phase 5.2 Stage 7 — Validation Results

**Date:** 2026-05-30  
**Repository:** `/Users/recharge/artist-platform`  
**Recovery anchor:** `bac9eb71f93dcbc0bee4099bf6d80ddaac29e049` (`bac9eb7`) — unchanged  
**Flags in env:** All hybrid flags **unset** (default OFF)

---

## Automated validation suite

| Check | Command | Result | Notes |
|-------|---------|--------|-------|
| Production build | `npm run build` | **PASS** | Next.js 16.2.4; compiled in ~9.4s; 52 routes |
| Foundation smoke | `npm run test:foundation` | **PASS** | 33/33 checks; anchor matches HEAD |
| Foundation verify (quick) | `npm run verify:foundation -- --quick` | **PASS*** | Guardrails 0 errors, 3 pre-existing warnings; PostHog keys missing in `.env.local` (non-blocking); build/lint skipped in `--quick` |
| Foundation verify (full) | `npm run verify:foundation` | **FAIL (pre-existing)** | `npm run lint` — 7 errors, 92 warnings; **not introduced by Phase 5.2** (no frontend component edits) |
| Playback resolver fallback | `npm run test:playback-resolver-fallback` | **PASS** | 21/21 scenarios |
| Backfill dry-run | `npm run backfill:stream-assets -- --yes --dry-run` | **PASS** | 36 candidates (6 products, 30 catalog_tracks); 0 failures |

\* Quick verify completes with advisory PostHog env notice; core foundation checks pass.

---

## Playback resolver fallback (Stage 5 + Stage 7 re-run)

```
playback-resolver-fallback: ok
scenarios: 21 passed
```

Categories covered: registration (5), validation (3), flags (3), fallback (5), stream hit (1), gate (3), shadow metrics (1).

---

## Backfill dry-run summary

```
candidates: 6 products, 30 catalog_tracks (36 total)
summary: { processed: 36, dry_run: 36, failed: 0 }
```

Notes:
- Stream DB columns not yet applied in connected Supabase — script falls back to metadata-only detection (expected pre-migration).
- `--yes` bypasses env flag gate for operator dry-run only; no transcodes executed.

---

## Regression scope confirmation

| Area | Phase 5.2 touched? | Validation |
|------|-------------------|------------|
| `AudioContext.js` / client playback | **No** | Not in diff; foundation smoke PASS |
| Cinematic shell / `src/app/page.js` | **No** | Guardrail warnings pre-existing |
| Collector download paths | **No** | No collector API or download route changes |
| Entitlements / `/api/account/state` | **No** | Unchanged |
| Recovery anchor / docs | **No** | HEAD = `bac9eb7`; operational anchor match PASS |
| Production env hybrid flags | **No** | Grep: no `HYBRID_STREAMING_*` in committed env files |

---

## Production curl (flags OFF — current deploy baseline)

Captured 2026-05-30T20:21Z from analysis egress → https://www.2mrrw.com  
**Note:** Production has **not** been deployed with Phase 5.2 code; these probes reflect **pre-deploy baseline** with flags OFF semantics identical to current master-only behavior.

| Probe | HTTP | TTFB (ms) | Runs |
|-------|------|-----------|------|
| `GET /api/media/preview?folder=previews/singles/hour-glass/` | 302 | 131–506 (median ~201) | 3 |
| `GET /api/library/stream?slug=hour-glass&redirect=1` | 401 | 165–257 (median ~178) | 3 |

Server-Timing headers not present on current production deploy (Phase 4.8 instrumentation is local/undeployed). See `latency-comparison.md` for Phase 4.7/4.8 baselines vs projected post-rollout.

---

## Local Server-Timing (Phase 5.2 build)

Attempted `next start -p 3099` for local curl with Server-Timing segments. **Blocked** by sandbox `uv_interface_addresses` system error on Next.js start-server. Local latency re-measure deferred; Phase 4.8 local warm-path figures used as proxy for post-deploy instrumentation shape.

---

## Items pending operator rollout

| Item | Status |
|------|--------|
| Apply Supabase migration `20260530160000_stream_asset_registration.sql` | Pending |
| Staging deploy of Phase 5.2 code | Pending |
| Entitled 200 stream TTFB with session cookie | Pending |
| iOS Safari 375px manual tap→audible | Pending (see `mobile-checklist.md`) |
| Production flag canary | Pending — flags remain OFF |

---

## Stage 7 verdict

**PASS** — All Phase 5.2-scoped automated checks pass. Full lint verify failure is pre-existing and out of scope. Implementation complete; operator rollout pending.
