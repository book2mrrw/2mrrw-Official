# Rollback Instructions — Phase 5.3.4

**Run date:** 2026-05-31  
**Rollback type:** Env-only — no data restore required

---

## Immediate rollback (< 5 minutes)

Set either flag to disable stream-first playback:

```bash
# Option A — stop stream preference, keep hybrid infra active
STREAM_PLAYBACK_PREFERRED=0

# Option B — disable all hybrid paths
HYBRID_STREAMING_ENABLED=0
```

Redeploy or restart dev server. No database migration. No R2 object deletion.

---

## What rollback restores

| State | After rollback |
|-------|----------------|
| Entitled playback | Master WAV/MP3 keys only |
| Guest preview | Unchanged (never used hybrid) |
| Stream objects in R2 | **Remain** — inert until flags re-enabled |
| DB `stream_path` / `stream_key` | **Remain** — inert |
| Upload pipeline | Unchanged (`AUTO_GENERATE_STREAM_ASSETS=0`) |
| Client URLs | Same `/api/library/stream` shape |

---

## Rollback validation (automated)

`npm run test:playback-resolver-fallback` proves:

| Scenario | Result |
|----------|--------|
| `flags-hybrid-off-preferred-on` | Preferred ignored → master |
| `flags-hybrid-on-preferred-off` | Master only |
| `gate-master-kept-flags-off` | Master signed |
| `gate-master-kept-on-r2-miss` | Fallback on miss |

**21/21 PASS** at activation time.

---

## Vercel rollback procedure

1. Project → Settings → Environment Variables
2. Set `STREAM_PLAYBACK_PREFERRED=0` (quick) or `HYBRID_STREAMING_ENABLED=0` (full)
3. Redeploy previous deployment OR trigger new deploy
4. Verify entitled probe returns master key (large WAV Content-Length)

---

## Local rollback

Remove or comment hybrid lines in `.env.local`:

```
HYBRID_STREAMING_ENABLED=0
STREAM_PLAYBACK_PREFERRED=0
```

Restart `npm run dev`.

---

## What rollback does NOT do

- Does not delete stream AAC objects
- Does not revert R2 master path remediation (5.3.3B)
- Does not restore foundation baseline doc drift
- Does not disable direct preview (separate flags)

---

## Rollback verdict

**PASS** — Proven safe; zero data restore required.
