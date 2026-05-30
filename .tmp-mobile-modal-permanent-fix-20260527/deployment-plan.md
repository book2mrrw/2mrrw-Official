# Deployment Plan

## Release

| Field | Value |
|-------|--------|
| **Branch** | `main` |
| **Commit** | `db88530` |
| **Message** | `fix(modal): permanent mobile modal and account tab crash fixes` |
| **Vercel deployment ID** | `dpl_3STkrSuFwUchTvtNmhDyux1XGobP` |
| **Inspect** | https://vercel.com/eellian-morrows-projects/artist-platform/3STkrSuFwUchTvtNmhDyux1XGobP |
| **Production URL** | https://www.2mrrw.com |

## Steps executed

1. Local `npm run build` — success.
2. `git push origin main` — `0b26e4c..db88530`.
3. `npx vercel deploy --prod --yes` — READY, production alias updated.

## Rollback

If issues appear:

```bash
git revert db88530
git push origin main
npx vercel deploy --prod --yes
```

Or promote previous deployment in Vercel dashboard (pre-`db88530`).

## Post-deploy validation

Run `qa-verification-checklist.md` on iPhone Safari within 30 minutes of deploy. Priority: email-only user → My Account; single + album modals.
