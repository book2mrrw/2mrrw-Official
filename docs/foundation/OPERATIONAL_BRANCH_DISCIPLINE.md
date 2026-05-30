# Operational Branch Discipline

Final model for 2MRRW **artist-platform** (storefront) and coordinated work with **2MRRW-Control-System** (release management).

## Branch roles

| Branch | Role |
|--------|------|
| `main` | **Promotion-only ledger.** Tagged foundation releases only. No day-to-day feature commits. |
| `dev` | **Integration branch.** All ongoing work lands here first (features, schema, APIs, UI). |
| `feature/*` | Short-lived branches cut from `dev` for focused work; merge back to `dev`. |

## Foundation tags (immutable)

Do **not** move or rewrite:

- `foundation-stable-v1`
- `foundation-stable-v2`
- `foundation-stable-v3`

Recovery and `verify:foundation` continue to anchor on these tags. Weakening verify scripts or guardrails is not permitted.

## Current ledger state (2026-05-30)

| Ref | Commit | Notes |
|-----|--------|-------|
| `foundation-stable-v3` | `0264124` | Phase 5.1.5 promoted foundation snapshot (main HEAD) |
| `main` | `0264124` | Aligned with v3 after recovery baseline sync |

`main` and `foundation-stable-v3` are aligned at the same commit. Verify and recovery target v3 semantics via `recovery-anchor.json`.

## After a foundation-stable-vX tag

1. Tag `foundation-stable-vX` on the promoted `main` commit only after full `npm run verify:foundation` (and control-system equivalent where applicable).
2. **No commits to `main`** until the next promotion window.
3. All implementation work happens on `dev` or `feature/*` → `dev`.

## Promotion flow (next: v4)

When `dev` is stable and verified:

1. Open promotion PR: `dev` → `main` (no force push).
2. Run foundation verification on the merge commit.
3. Tag `foundation-stable-v4` on `main`.
4. Update `docs/foundation/recovery-anchor.json` and related recovery docs on `main` only as part of promotion.
5. Resume feature work on `dev`; `main` returns to promotion-only.

## Control System coordination

- Control repo should follow the same **dev-first** discipline where possible.
- Release/pricing schema in Control System Supabase is the **write path** for catalog commerce fields; artist-platform consumes via public release APIs and keeps `products` in sync for checkout (`price_cents` authoritative at payment intent).

## Commands (artist-platform)

```bash
git checkout dev
git pull origin dev
# work, commit on dev
npm run verify:foundation   # before promotion PR
```
