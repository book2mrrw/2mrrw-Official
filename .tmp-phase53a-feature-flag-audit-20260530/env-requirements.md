# Phase 5.3A — Environment Requirements

**Audit date:** 2026-05-30  
**Policy:** All hybrid flags must remain **disabled** (`0` or unset) until operator approval.

---

## Required variables (Phase 5.2 hybrid)

| Variable | Safe default | Required when | Server-side |
|----------|--------------|---------------|-------------|
| `HYBRID_STREAMING_ENABLED` | `0` or unset | Any hybrid path | Yes |
| `STREAM_PLAYBACK_PREFERRED` | `0` or unset | Stream-first playback | Yes |
| `AUTO_GENERATE_STREAM_ASSETS` | `0` or unset | Upload/backfill transcode | Yes |

### Optional related variable

| Variable | Safe default | Purpose |
|----------|--------------|---------|
| `FFMPEG_PATH` | unset (use `ffmpeg` on PATH) | Explicit ffmpeg binary for transcode pipeline and backfill CLI |
| `R2_STREAM_DEBUG` | unset | Log R2 env presence + resolver diagnostics header (already in `.env.example`) |

---

## Safe default block (copy to Vercel / local)

```bash
# Phase 5.2 — Hybrid streaming (DO NOT enable without operator approval)
HYBRID_STREAMING_ENABLED=0
STREAM_PLAYBACK_PREFERRED=0
AUTO_GENERATE_STREAM_ASSETS=0
```

**Do not set to `1` or `true` until:** migration applied, staging canary passed, rollback drill complete.

---

## What exists vs missing

| Location | Status | Notes |
|----------|--------|-------|
| `.env.local` | **Missing flags** ✅ | Grep: no hybrid vars — implicit OFF |
| `.env.example` | **Present (audit update)** ✅ | Added disabled defaults `=0` + commented `FFMPEG_PATH` |
| `.env` | **Not in repo** | N/A |
| `.env.production` | **Not in repo** | N/A |
| `vercel.json` | **No flag entries** ✅ | Expected — flags belong in Vercel env dashboard |
| `next.config.js` / `next.config.mjs` | **No references** ✅ | Flags read at runtime from `process.env` |
| `docs/` | **No dedicated flag doc** ⚠️ | Phase 5.2 `.tmp-phase52-*` reports are authoritative until docs added |
| Vercel production/preview env | **Unverified** ⚠️ | Vercel MCP has no env-list tool; operator must confirm dashboard |

---

## Prerequisite env (unchanged — required for hybrid when enabled)

These already exist in `.env.example` and are required for stream pipeline when flags are eventually enabled:

| Variable | Purpose for hybrid |
|----------|-------------------|
| `CLOUDFLARE_R2_ACCOUNT_ID` | R2 access |
| `CLOUDFLARE_R2_ENDPOINT` | R2 S3 API |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 auth |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 auth |
| `CLOUDFLARE_R2_BUCKET_NAME` | Media bucket (`2mrrw-media`) |
| Supabase service credentials | DB registration (`stream_path`, `stream_key`) |
| `ADMIN_SEED_SECRET` | Admin catalog sync route authorization |

---

## Vercel deployment notes

- Flags are **server-side** — set in Vercel Project → Settings → Environment Variables.
- Scope separately for **Production**, **Preview**, **Development** if staging canary differs from prod.
- Propagation: typically <5 minutes after save + redeploy (or env-only refresh on Fluid Compute).
- **No entries in `vercel.json`** — correct pattern for this project.

### Recommended Vercel state (pre-activation)

| Environment | HYBRID | PREFERRED | AUTO |
|-------------|--------|-----------|------|
| Production | unset or `0` | unset or `0` | unset or `0` |
| Preview (staging) | unset or `0` until canary | unset or `0` | unset or `0` |
| Local dev | unset or `0` | unset or `0` | unset or `0` |

---

## `.env.example` additions (audit deliverable)

Added to `.env.example` (disabled defaults only):

```bash
HYBRID_STREAMING_ENABLED=0
STREAM_PLAYBACK_PREFERRED=0
AUTO_GENERATE_STREAM_ASSETS=0
# FFMPEG_PATH=/usr/local/bin/ffmpeg  # optional
```

---

## Validation performed (read-only)

```bash
rg 'HYBRID_STREAMING|STREAM_PLAYBACK|AUTO_GENERATE_STREAM' .env.local .env.example
# .env.local: no matches
# .env.example: matches after audit template addition only (all =0)
```

**Secrets:** `.env.local` contents not logged or committed. Presence of R2/Supabase keys assumed from existing project operation; not re-audited here.

---

## Operator checklist before any flag = 1

- [ ] Confirm Vercel Production has all three flags unset or `0`
- [ ] Apply Supabase migration `20260530160000_stream_asset_registration.sql`
- [ ] Deploy Phase 5.2 code to staging with flags still `0`
- [ ] Verify `npm run test:playback-resolver-fallback` passes in CI/local
- [ ] Document rollback owner and env access for emergency toggle
