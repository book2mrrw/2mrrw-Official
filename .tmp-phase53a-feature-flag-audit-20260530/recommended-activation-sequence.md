# Phase 5.3A — Recommended Activation Sequence

**Audit date:** 2026-05-30  
**Prerequisite:** Operator approval after reviewing `activation-readiness.md` (overall **FAIL** until migration + staging complete).

---

## One-liner

**Apply migration → deploy flags `=0` → limited backfill → staging `HYBRID=1` + `AUTO=1` + `PREFERRED=0` → staging canary `PREFERRED=1` → production incremental enable with rollback drill.**

---

## Phase 0 — Pre-flight (no flags enabled)

| Step | Action | Env state |
|------|--------|-----------|
| 0.1 | Confirm Vercel Production/Preview: all three flags **unset or `0`** | All OFF |
| 0.2 | Add disabled defaults to team runbook / `.env.example` (done in audit) | Documented |
| 0.3 | Run `npm run test:playback-resolver-fallback` | N/A — expect 21/21 |
| 0.4 | Run `npm run verify:foundation -- --quick` | N/A — baseline green |

---

## Phase 1 — Schema + deploy (flags still OFF)

| Step | Action | Env state |
|------|--------|-----------|
| 1.1 | Apply `supabase/migrations/20260530160000_stream_asset_registration.sql` to Supabase | All OFF |
| 1.2 | Deploy Phase 5.2 code to **Preview/staging** | All OFF |
| 1.3 | Smoke: entitled stream playback on staging — **must match prod (master-only)** | All OFF |
| 1.4 | Deploy to **Production** with flags still OFF | All OFF |

**Exit criteria:** Production behavior unchanged; migration applied; no resolver regression.

---

## Phase 2 — Asset generation (playback still master-only)

| Step | Action | Env state |
|------|--------|-----------|
| 2.1 | Staging: `npm run backfill:stream-assets -- --yes --dry-run` — review candidates (~36) | HYBRID=1, AUTO=1, PREFERRED=0 |
| 2.2 | Limited live backfill: `--limit 5` from operator machine with ffmpeg + R2 creds | Same |
| 2.3 | Verify R2 `streaming/` objects + DB `stream_path`/`stream_key` populated | Same |
| 2.4 | Confirm playback **still master-only** (`PREFERRED=0`) | HYBRID=1, AUTO=1, PREFERRED=0 |

**Why PREFERRED=0 here:** Generates stream assets without serving them — safest staging state (validated in Phase 5.2 rollback matrix).

**Optional:** Enable `AUTO=1` on admin sync only after backfill proves ffmpeg path on ops host (not necessarily Vercel serverless).

---

## Phase 3 — Staging playback canary

| Step | Action | Env state |
|------|--------|-----------|
| 3.1 | Staging Preview: set `STREAM_PLAYBACK_PREFERRED=1` | HYBRID=1, AUTO=1, PREFERRED=1 |
| 3.2 | Test entitled playback — expect stream key when registered, master fallback otherwise | All ON (staging) |
| 3.3 | Monitor `X-Playback-Resolver` / Server-Timing with `R2_STREAM_DEBUG=1` | Staging only |
| 3.4 | **Mobile Safari manual:** tap→audible, background, lock screen, Bluetooth | Staging |
| 3.5 | Rollback drill: set `PREFERRED=0` → confirm master playback <5 min | PREFERRED=0 |

**Exit criteria:** Stream hits reduce TTFB where assets exist; fallback never breaks playback; rollback proven.

---

## Phase 4 — Production incremental enablement

| Step | Action | Env state |
|------|--------|-----------|
| 4.1 | Production: `HYBRID_STREAMING_ENABLED=1` only (no sub-flags) | HYBRID=1, others 0 |
| 4.2 | Run production backfill in batches (`--limit N`, checkpoint resume) | HYBRID=1, AUTO=1, PREFERRED=0 |
| 4.3 | After ≥1 release has stream assets: `STREAM_PLAYBACK_PREFERRED=1` | HYBRID=1, AUTO=1, PREFERRED=1 |
| 4.4 | Monitor fallback rate via resolver diagnostics | Production |
| 4.5 | Enable `AUTO_GENERATE_STREAM_ASSETS=1` on prod sync **only if** ffmpeg path confirmed | Full hybrid |

**Recommended prod order:** HYBRID → backfill with AUTO → PREFERRED → AUTO on sync (if applicable).

---

## Emergency rollback (any phase)

```bash
STREAM_PLAYBACK_PREFERRED=0   # immediate master playback (<5 min)
# or full kill:
HYBRID_STREAMING_ENABLED=0
AUTO_GENERATE_STREAM_ASSETS=0
```

No code deploy required. Masters never modified.

---

## What NOT to do

- Do not enable all three flags in Production simultaneously without staging canary
- Do not enable `PREFERRED=1` before stream assets exist for target catalog (safe but adds resolver overhead)
- Do not rely on Vercel serverless for ffmpeg transcode without verifying binary availability
- Do not skip migration apply before backfill or sync registration writes

---

## Approval gate

**STOP** after Phase 5.3A audit. Proceed to Phase 0 only with explicit operator sign-off.
