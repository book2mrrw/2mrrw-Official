# Frontend Deployment Rules

Governance for shipping the 2MRRW artist platform frontend without breaking the official foundation.

## Production targets

| Alias | URL | Role |
|-------|-----|------|
| Primary | https://artist-platform-silk.vercel.app | Official user-facing production |
| Legacy | https://2mrrw-official.vercel.app | Referenced in embeds/webhooks docs |

Only deploy to production aliases from **`main`** or a release tag cut from `frontend-stable-foundation` after full verification.

## Pre-deploy gate (required)

All must pass on the commit being deployed:

```bash
npm ci
npm run verify:foundation
```

`verify:foundation` runs guardrails, foundation smoke, env key check (names only), lint, and build. Equivalent manual steps:

```bash
npm run check:frontend-guardrails
npm run test:foundation
npm run lint
npm run build
```

## Recovery-aware deploy

- **Never** deploy from recovery scripts without explicit intent: `npm run recover:deploy -- --deploy`
- Full local restore before production redeploy: `npm run recover:foundation`
- Rollback playbook: `FRONTEND_EMERGENCY_RECOVERY_PLAYBOOK.md`
- Anchor source: `docs/foundation/recovery-anchor.json`

## Branch → environment mapping

| Branch | May deploy to production? |
|--------|---------------------------|
| `main` | Yes, after gates |
| `frontend-stable-foundation` | Yes, only for recovery promote |
| `frontend-feature-dev` | Preview only |
| `frontend-animation-testing` | Preview only |
| `frontend-audit-testing` | Preview only |
| `frontend-experimental` | **Never** production |

## Deploy methods

1. **CLI:** `npm run deploy:prod` (requires Vercel auth)
2. **Git integration:** Vercel auto-build on push to `main`

Prefer preview deployment for any change touching `page.js`, framer-motion, or media paths.

## Environment rules

- Production env vars managed in Vercel project settings
- Never commit `.env.local`, service role keys, or webhook secrets
- `NEXT_PUBLIC_*` only for browser-safe values
- After env change: rebuild — do not assume hot reload on Vercel

## Rollback rules

1. **First:** Promote previous known-good deployment in Vercel (fastest) — `npm run recover:rollback`
2. **Second:** `npm run recover:foundation` then `npm run recover:deploy -- --deploy` from anchor in `recovery-anchor.json`
3. Document rollback in `FRONTEND_FOUNDATION_REPORT.md`
4. **Never** `git push --force` to `main` or `frontend-stable-foundation` from recovery scripts

## Post-deploy verification (15 min)

- `/` loads, hero media plays or degrades gracefully
- `/api/account/state` — no 500 storm in network tab
- Subscribe/checkout Stripe UI renders
- Global audio bar functional
- No new console errors on cold load

## Forbidden deployments

- From `frontend-experimental`
- With failing `build` or `test:foundation`
- With unpinned `^` / `~` in production dependencies
- Intentional UI redesign without user sign-off and baseline doc update

## Communication

When promoting a new foundation anchor (rare):

1. Update `FRONTEND_FOUNDATION_BASELINE.md` with new commit hash
2. Reset `frontend-stable-foundation` pointer
3. Run full verification suite
4. Note production URL and deploy ID in `FRONTEND_FOUNDATION_REPORT.md`
