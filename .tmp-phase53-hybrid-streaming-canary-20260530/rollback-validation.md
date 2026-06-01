# Rollback Validation — Hybrid Streaming Canary (Phase 5.3)

**Run date:** 2026-05-31  
**Section result:** **PASS**

---

## Rollback mechanism

Hybrid behavior is **entirely env-gated**. No code revert required for operational rollback.

```bash
HYBRID_STREAMING_ENABLED=0    # or unset
STREAM_PLAYBACK_PREFERRED=0   # or unset
AUTO_GENERATE_STREAM_ASSETS=0 # or unset
```

Redeploy or restart. Master-only playback and upload resume immediately.

**Source:** `src/lib/feature-flags/hybrid-streaming.js`

---

## Automated proof (2026-05-31)

```bash
# Default (flags OFF)
npm run test:playback-resolver-fallback
# → 21/21 PASS

# Canary (flags ON)
HYBRID_STREAMING_ENABLED=1 STREAM_PLAYBACK_PREFERRED=1 \
  npm run test:playback-resolver-fallback
# → 21/21 PASS
```

### Key rollback scenarios

| Scenario ID | Condition | Expected | Result |
|-------------|-----------|----------|--------|
| `flags-hybrid-off-preferred-on` | HYBRID=0, PREFERRED=1 | `isStreamPlaybackPreferred()` false | **PASS** |
| `flags-hybrid-on-preferred-off` | HYBRID=1, PREFERRED=0 | Master only; reason `flags_off` | **PASS** |
| `fallback-hybrid-on-preferred-off` | Stream registered, preferred off | Master key returned | **PASS** |
| `gate-master-kept-flags-off` | Full resolve gate | Master unchanged | **PASS** |
| `gate-master-kept-on-r2-miss` | Stream miss | Master retained | **PASS** |

---

## Partial rollback options

| Action | Effect | Use when |
|--------|--------|----------|
| `STREAM_PLAYBACK_PREFERRED=0` alone | Stop serving streams; keep generating assets | Quick playback rollback |
| `HYBRID_STREAMING_ENABLED=0` | Disable all hybrid paths | Full rollback |
| `AUTO_GENERATE_STREAM_ASSETS=0` | Stop upload transcode only | Playback canary continues |

Setting `STREAM_PLAYBACK_PREFERRED=0` (even with HYBRID=1) **restores master-only resolver** — validated.

---

## Data rollback

| Asset | Action | Playback impact when flags OFF |
|-------|--------|-------------------------------|
| Masters in `digital-assets/` | **Never modified** | None |
| Stream files in `streaming/` | Optional delete (R2 console) | None |
| DB `stream_path` / `stream_key` | Columns ignored when flags OFF | None |
| `.backfill-stream-checkpoint.json` | Delete to reset progress | None |

---

## Client / UI rollback impact

| System | Flags OFF behavior |
|--------|-------------------|
| `AudioContext` | Unchanged — same play engine |
| `resolvePlaybackSrc` | Same library stream URLs |
| Guest preview | Unchanged (direct preview separate flags) |
| Queue / Media Session | Unchanged |
| Analytics / stream sessions | Unchanged semantics |
| Offline downloads | Unchanged |

No stale client state — stream URLs resolved per request server-side.

---

## Production env confirmation

Workspace `.env*` grep (2026-05-31): **no hybrid flags set**.

Vercel production: **unverified this session** — operator should confirm all three vars absent or `0` in Production environment.

---

## Emergency code rollback

If env rollback insufficient:

1. `npm run recover:foundation -- --dry-run`
2. Selective restore per `docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md`
3. Revert stream gate in `resolve-playback-key.js` L250–261 if needed

Recovery anchor drift noted in `test:foundation` — pre-existing, not hybrid-introduced.

---

## Rollback time estimate

| Strategy | Time | Risk |
|----------|------|------|
| Vercel env `=0` + redeploy | Minutes | **Low** |
| `STREAM_PLAYBACK_PREFERRED=0` only | Minutes | **Low** |
| Code revert stream gate | Minutes | **Low** |
| Delete `streaming/` R2 objects | Optional | None when flags OFF |

---

## Section result

**PASS** — Env toggle proven by 21 automated scenarios. Master playback restored when `HYBRID_STREAMING_ENABLED=0` or `STREAM_PLAYBACK_PREFERRED=0`.
