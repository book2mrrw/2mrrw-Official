# 2MRRW Recovery — Frontend Pointer

Disaster recovery documentation and snapshots live in the **control** repository.

## Canonical recovery bundle

**Repo:** [2MRRW-Control-System](https://github.com/your-org/2MRRW-Control-System) (local: `~/2MRRW-Control-System`)  
**Path:** `2MRRW_RECOVERY_SYSTEM/`  
**Start:** `2MRRW_RECOVERY_SYSTEM/README.md`

## This repo in recovery

| Field | Value |
|-------|--------|
| **Production URL** | https://artist-platform-silk.vercel.app |
| **Control API** | `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` → https://2-mrrw-control-system.vercel.app |
| **Site URL** | `NEXT_PUBLIC_SITE_URL` → https://artist-platform-silk.vercel.app |
| **Env template** | `.env.example` (also copied in control bundle as `ENVIRONMENT_BACKUPS/artist-platform.env.example`) |

## Rapid frontend restore

1. Restore control first (`foundation-stable-v1` in control repo).
2. Confirm control smoke: `/api/health/basic` and **9** releases.
3. Set Vercel Production env (names in control repo `RECOVERY_GUIDES/ENVIRONMENT_VARIABLE_RECOVERY.md`).
4. Redeploy:

```bash
npm ci
npx vercel --prod --yes
```

## Full platform guide

See control repo: `2MRRW_RECOVERY_SYSTEM/RECOVERY_GUIDES/FULL_RECOVERY_GUIDE.md` (Phase C — frontend).
