# Phase 5.1.5 — Recovery Anchor Audit

**Date:** 2026-05-30  
**Repository:** artist-platform @ `/Users/recharge/artist-platform`

## Canonical anchor source

| Artifact | Path | Role |
|----------|------|------|
| Machine-readable anchor | `docs/foundation/recovery-anchor.json` | Single source of truth for scripts |
| Human baseline | `docs/foundation/FRONTEND_FOUNDATION_BASELINE.md` | Stack snapshot + verification commands |
| Recovery entry | `docs/foundation/FRONTEND_RECOVERY_ANCHOR.md` | One-line recovery path |
| Script loader | `scripts/recovery/lib/anchor.mjs` | Reads JSON; resolves `operationalTag` via git |

## Pre-sync state (audit)

| Ref | Commit | Status |
|-----|--------|--------|
| `HEAD` (main) | `e8402d8` | Current platform (Phase 5.1 docs + Phase 4.8 prod) |
| `recovery-anchor.json` → `commit` | `48f97dd` | **STALE** (2026-05-23) |
| `foundation-stable-v3` tag | `0866f99` | **STALE** (153 commits behind HEAD) |
| `frontend-stable-foundation` branch | `42a4bd9` | **STALE** (not updated this phase) |
| `foundation-stable-v1` (immutable UI) | `ce6ae20` | OK — never move |
| `foundation-stable-v2` (historical) | `42a4bd9` | OK — never move |

**Drift before sync:** 154 commits between old anchor (`48f97dd`) and pre-sync HEAD (`e8402d8`); 153 commits between old `foundation-stable-v3` (`0866f99`) and HEAD.

## Post-sync state

| Ref | Commit | Status |
|-----|--------|--------|
| `HEAD` (main) | `bac9eb7` | Recovery sync commit |
| `foundation-stable-v3` tag | `bac9eb7` | **PROMOTED** — aligned with HEAD |
| `recovery-anchor.json` → `commit` | `0264124` | Platform tree (1 metadata amend behind tag; functionally identical) |
| `frontend-checkpoint-20260530-1423` | `bac9eb7` | New milestone checkpoint |

**Operational drift after sync:** **0** (`HEAD` == `foundation-stable-v3` == `bac9eb7`)

## Recovery script inventory (`scripts/recovery/`)

| Script | npm command | Purpose |
|--------|-------------|---------|
| `recover-foundation.mjs` | `recover:foundation` | Full local restore (checkout anchor, npm ci, verify) |
| `verify-foundation.mjs` | `verify:foundation` | Guardrails + smoke + lint/build |
| `recover-stable.mjs` | `recover:stable` | Align `frontend-stable-foundation` branch |
| `create-frontend-checkpoint.mjs` | `recover:checkpoint` | Tag + manifest checkpoint |
| `recover-rollback.mjs` | `recover:rollback` | Production rollback guide |
| `recover-deploy.mjs` | `recover:deploy` | Gated production deploy |

## Sacred tag discipline

- `foundation-stable-v1` → `ce6ae20` — **never move** (UI-only rollback)
- `foundation-stable-v2` → `42a4bd9` — historical reference only
- `foundation-stable-v3` → **promoted to `bac9eb7`** (2026-05-30 Phase 5.1.5)

## Notes

- Verify scripts resolve operational commit via `foundation-stable-v3` tag, not `recovery-anchor.json` `commit` alone.
- Prefer `git checkout foundation-stable-v3` for full promoted baseline including checkpoint manifest.
- `recover:foundation` reads `anchor.commit` (`0264124`); tree diff to `bac9eb7` is metadata-only (hash strings in docs + checkpoint manifest).
