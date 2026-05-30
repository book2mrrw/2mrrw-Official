# 2MRRW Build Frame of Mind — Implementation Report

**Date:** 2026-05-27  
**Source prompt:** `/Users/recharge/Downloads/2mrrw-build-frame-of-mind.md`

## Prompt summary

The prompt defines the platform building frame of mind for every AI build session:

- 2MRRW is one artist's sovereign world (not a catalog app)
- Mobile-first (iOS Safari primary); scale up, never compromise mobile
- Cross-platform consistency (colors, motion, audio, interactions)
- Audio as first-class native behavior (lock screen, background, handoff)
- Fan-respect standards (one tap, feedback, no broken errors, entitlements from server)
- Aesthetic bar (artist identity, 44×44 targets, safe areas, native scroll)
- Explicit never/always lists for Claude in this codebase
- Checkpoint + deploy discipline (selective recovery; migrations → main → Vercel)

No application code changes were specified — integration into foundation docs and Cursor rules.

## Files changed

| File | Action |
|------|--------|
| `docs/foundation/BUILD_FRAME_OF_MIND.md` | Added (full prompt content) |
| `.cursor/rules/build-frame-of-mind.mdc` | Added (always-on condensed rule) |
| `PROJECT_GUARDRAILS.md` | Updated references + workflow index |
| `.cursor/rules/project-guardrails.mdc` | Linked new rule |
| `docs/foundation/checkpoints/checkpoint-20260527-2351.md` | Checkpoint manifest |

## Build status

- **Local:** `npm run build` — **passed** (Next.js 16.2.4, exit 0)
- **Vercel production build:** **passed** during deploy

## Git

| Item | Value |
|------|-------|
| Primary commit | `43c2fadee9a92ef3b94ebc867212af2cb154c981` |
| Checkpoint commit | `4100ee3` (checkpoint doc on main) |
| Tag | `frontend-checkpoint-20260527-2351` → `43c2fad` |
| Branch | `main` pushed to `origin/main` |

## Deploy

| Field | Value |
|-------|-------|
| Deploy ID | `dpl_A9kqC3icFx5rZ9RSgyFQY3nhrhPj` |
| Production URL | https://artist-platform-ckpyg7ul8-eellian-morrows-projects.vercel.app |
| Alias | https://www.2mrrw.com |
| Inspector | https://vercel.com/eellian-morrows-projects/artist-platform/A9kqC3icFx5rZ9RSgyFQY3nhrhPj |

## Notes

- Docs-only change; no runtime behavior modified.
- Existing production audio/auth/modal fixes preserved.
