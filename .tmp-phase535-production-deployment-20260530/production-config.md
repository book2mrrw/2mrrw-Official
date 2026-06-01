# Production Configuration — Phase 5.3.5

**Project:** `artist-platform` (Vercel)  
**Team:** `eellian-morrows-projects`  
**Run date:** 2026-05-31

---

## Flags set (Production only)

| Variable | Value | Action |
|----------|-------|--------|
| `HYBRID_STREAMING_ENABLED` | `1` | **Added** via `vercel env add` |
| `STREAM_PLAYBACK_PREFERRED` | `1` | **Added** via `vercel env add` |

---

## Flags NOT modified

| Variable | Notes |
|----------|-------|
| `DIRECT_PREVIEW_*` | Not touched — direct preview remains OFF per Phase 5.3.4 scope |
| `AUTO_GENERATE_STREAM_ASSETS` | Not touched — upload pipeline unchanged |
| `R2_STREAM_DEBUG` | Not enabled in production |
| All Stripe / Supabase / R2 credentials | Unchanged |

---

## Confirmation (`vercel env ls production`)

```
HYBRID_STREAMING_ENABLED          Encrypted    Production
STREAM_PLAYBACK_PREFERRED         Encrypted    Production
```

Listed 2026-05-31 after add operations.

---

## Runtime behavior when both flags = 1

- `isStreamPlaybackPreferred()` → true (requires both flags)
- `/api/library/stream` → `resolvePlaybackKey` stream-first, master fallback
- Guest preview → unchanged (`/api/media/preview`, no hybrid reads on client)

---

## Redeploy requirement

Env vars applied before production redeploy. Final active deployment: **`dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83`** (redeploy of `250e2bb` build with new env).
