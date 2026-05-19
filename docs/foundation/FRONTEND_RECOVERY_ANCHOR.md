# Frontend Recovery Anchor

**Canonical source:** [`recovery-anchor.json`](./recovery-anchor.json) — scripts read commit, branch, URLs, and dependency pins from this file.

This document is the **fastest human-readable path** back to the known-good cinematic frontend.

## One-line recovery

```bash
npm run recover:foundation
```

Or checkout the anchor commit directly:

```bash
git checkout ce6ae20e34fd7e1bf1278d5f6da5c07fb7fee15c
```

Or use the stable branch:

```bash
git checkout frontend-stable-foundation
```

## What you are restoring

- Production-aligned UI at https://artist-platform-silk.vercel.app
- Next.js 16.2.4 + React 19.2.4 client-rendered cinematic `page.js`
- framer-motion atmosphere with reduced-motion support
- Auth/entitlement hydration via `/api/account/state`
- Global audio bar and Stripe checkout shell

## Recovery checklist (5 minutes)

1. `git status` — stash or branch unrelated work
2. `npm run recover:stable` — ensure `frontend-stable-foundation` points at anchor (optional)
3. `npm run recover:foundation` — reinstall, verify, optional `--deploy`
4. `npm run verify:foundation` — guardrails + smoke + build
5. Compare locally (`npm run dev`) against production URL

## When to use full protocol

If dependencies, env vars, or Vercel config changed, follow `FRONTEND_RECOVERY_PROTOCOL.md` and `FRONTEND_EMERGENCY_RECOVERY_PLAYBOOK.md`.

## Do not

- Force-push `main` or `frontend-stable-foundation`
- Deploy experimental branches to production aliases
- Re-pin major versions without updating `recovery-anchor.json`

## Related files

- `recovery-anchor.json` — machine-readable anchor (single source of truth)
- `FRONTEND_RECOVERY_COMMAND_REPORT.md` — all npm recovery commands
- `CURSOR_RECOVERY_WORKFLOWS.md` — copy-paste Cursor/terminal workflows
- `FRONTEND_FOUNDATION_BASELINE.md` — full stack snapshot
- `FRONTEND_RECOVERY_PROTOCOL.md` — step-by-step recovery workflow
