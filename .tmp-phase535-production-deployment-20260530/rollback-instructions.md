# Rollback Instructions — Phase 5.3.5

**Active production deployment:** `dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83`  
**Previous production (pre-hybrid flags deploy):** `dpl_65HN3X4LhiLUrTayJNpcQj3n3qrd` (`82aeeb0`)  
**Run date:** 2026-05-31

---

## Option A — Fast flag rollback (< 5 min, recommended)

Disable stream-first without removing hybrid infrastructure:

```bash
cd /Users/recharge/artist-platform

# Quick disable (stream-first off)
printf '0' | npx vercel env add STREAM_PLAYBACK_PREFERRED production
# If variable exists, remove and re-add, or use Vercel dashboard → edit value to 0

# Full hybrid off (optional)
printf '0' | npx vercel env add HYBRID_STREAMING_ENABLED production

# Redeploy production to apply env
npx vercel redeploy dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83
```

**Verify:** Entitled playback returns master-signed URLs; guest preview unchanged.

---

## Option B — Promote previous deployment

Instant rollback to pre-5.3.4-commit deployment (also removes `.env.example` doc commit from live site — same code as `82aeeb0`):

```bash
npx vercel promote dpl_65HN3X4LhiLUrTayJNpcQj3n3qrd --yes
```

Also set flags to `0` in dashboard if env vars persist across promotions.

---

## Option C — Remove env vars entirely

```bash
npx vercel env rm HYBRID_STREAMING_ENABLED production
npx vercel env rm STREAM_PLAYBACK_PREFERRED production
npx vercel redeploy dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83
```

---

## What rollback does NOT do

- Does not delete R2 stream AAC objects
- Does not revert Supabase `stream_path` / `stream_key` registrations
- Does not change guest preview URLs
- Does not revert local uncommitted WIP files

---

## Rollback validation checklist

1. Guest: preview plays (CDN/API 302)
2. Guest: `/api/library/stream` → 401/403
3. Entitled: stream returns master key or signed master proxy
4. `npm run test:playback-resolver-fallback` → 21/21 with flags off locally

---

## One-line rollback command (flags off + redeploy)

```bash
cd /Users/recharge/artist-platform && printf '0' | npx vercel env add STREAM_PLAYBACK_PREFERRED production && npx vercel redeploy dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83
```

For full hybrid disable, also set `HYBRID_STREAMING_ENABLED=0` before redeploy.
