# Phase 5.2 Stage 7 — Rollback Validation

**Date:** 2026-05-30  
**Recovery anchor:** `bac9eb71f93dcbc0bee4099bf6d80ddaac29e049` (`bac9eb7`)

---

## Rollback mechanism

Phase 5.2 hybrid behavior is **entirely env-gated**. No code revert required for operational rollback.

```bash
HYBRID_STREAMING_ENABLED=0    # or unset
STREAM_PLAYBACK_PREFERRED=0   # or unset
AUTO_GENERATE_STREAM_ASSETS=0 # or unset
```

Redeploy or restart after env change. Master-only playback and upload resume immediately.

---

## Automated rollback proof (Stage 5 + Stage 7 re-run)

| Scenario ID | Condition | Expected | Result |
|-------------|-----------|----------|--------|
| `flags-hybrid-off-preferred-on` | HYBRID=0, PREFERRED=1 | `isStreamPlaybackPreferred()` false | **PASS** |
| `flags-hybrid-on-preferred-off` | HYBRID=1, PREFERRED=0 | Master only; `flags_off` reason | **PASS** |
| `fallback-hybrid-on-preferred-off` | Stream registered but preferred off | Master key returned | **PASS** |
| `gate-master-kept-flags-off` | Full resolve gate | Master unchanged, no fallback reason | **PASS** |
| `gate-master-kept-on-r2-miss` | Stream miss | Master retained, `r2_missing` | **PASS** |

**Command:** `npm run test:playback-resolver-fallback` → **21/21 PASS**

---

## Partial enablement safety

| Env state | Upload transcode | Playback resolver | Risk |
|-----------|------------------|-------------------|------|
| All OFF (default) | Skipped | Master only | None — current prod |
| HYBRID=1, PREFERRED=0, AUTO=1 | Runs on sync | Master only | Stream assets generated but not served — safe staging state |
| HYBRID=1, PREFERRED=1, AUTO=0 | Skipped | Stream-first + fallback | Requires pre-existing stream assets |
| All ON | Runs on sync | Stream-first + fallback | Full hybrid — canary target |

Setting `STREAM_PLAYBACK_PREFERRED=0` alone (even with HYBRID=1) **restores master-only resolver path** — validated by tests above.

---

## Data rollback

| Asset | Rollback action |
|-------|-----------------|
| Master files in `digital-assets/` | **Never modified** by Phase 5.2 — no rollback needed |
| Stream files in `streaming/` | Optional delete via R2 console; playback unaffected when flags OFF |
| DB `stream_path` / `stream_key` columns | Migration is additive; columns ignored when flags OFF |
| `.backfill-stream-checkpoint.json` | Delete to reset backfill progress; no playback impact |

---

## Code rollback (emergency)

If env rollback insufficient:

1. `npm run recover:foundation -- --dry-run` — inspect anchor diff
2. Selective restore per `docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md`
3. Recovery anchor `bac9eb7` unchanged throughout Phase 5.2 — frontend foundation intact

Phase 5.2 files are additive modules + gated branches; selective revert of `src/lib/playback/resolve-playback-key.js` stream gate restores pre-5.2 resolver if needed.

---

## Production env confirmation

Grep of workspace env files: **no** `HYBRID_STREAMING_ENABLED`, `STREAM_PLAYBACK_PREFERRED`, or `AUTO_GENERATE_STREAM_ASSETS` values set.

**Rollback validation: PASS** — flags OFF = master-only; env toggle proven by 21 automated scenarios.
