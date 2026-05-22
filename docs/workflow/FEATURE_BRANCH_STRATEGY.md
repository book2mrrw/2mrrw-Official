# Feature Branch Strategy

Branch discipline for artist-platform **integrates** with foundation recovery. Operational truth: [`../foundation/OPERATIONAL_BRANCH_DISCIPLINE.md`](../foundation/OPERATIONAL_BRANCH_DISCIPLINE.md) and [`../foundation/recovery-anchor.json`](../foundation/recovery-anchor.json).

## Sacred branches and tags

| Ref | Role |
|-----|------|
| `main` | **Promotion-only** — foundation releases and anchor metadata; not day-to-day feature commits |
| `dev` | **Integration** — ongoing work lands here first |
| `frontend-stable-foundation` | Recovery pointer aligned to `recovery-anchor.json` commit |
| `foundation-stable-v1` … `v3` | **Immutable tags** — never move or force-push |

Do not recreate anchor commits in docs — read `recovery-anchor.json` for current `commit`, `branch`, and `operationalTag`.

## Feature branch naming

Cut from `dev` (or from `frontend-stable-foundation` only when recovering then branching):

```
feature/<short-kebab-name>
```

Examples:

- `feature/vault-pricing-copy`
- `feature/mobile-cart-sheet`
- `feature/glyphs-pulse-tuning`

### Experimental / audit branches (foundation legacy names)

Still valid for specialized work (see [`../foundation/FRONTEND_RECOVERY_PROTOCOL.md`](../foundation/FRONTEND_RECOVERY_PROTOCOL.md)):

| Branch | Use |
|--------|-----|
| `frontend-feature-dev` | Controlled UI/feature integration |
| `frontend-animation-testing` | Motion / MP4 experiments — never force-push |
| `frontend-audit-testing` | Guardrails and foundation smoke |
| `frontend-experimental` | Throwaway spikes — never deploy directly |

Prefer aligning new work with `dev` + `feature/*` per operational discipline; use foundation-named branches when matching existing recovery docs.

## Workflow

1. `git checkout dev && git pull`
2. `git checkout -b feature/my-change`
3. Implement within scope — [`FEATURE_ISOLATION.md`](FEATURE_ISOLATION.md)
4. `npm run verify:foundation` (required before PR to `dev`)
5. PR: `feature/*` → `dev`
6. Promotion (human-gated): `dev` → `main` + new `foundation-stable-vX` tag + update `recovery-anchor.json`

## One feature per branch

- Avoid mixing Vault + Checkout + hero changes in one branch.
- If scope grows, split branch or document explicit multi-module scope in PR description.

## Recovery interaction

| Situation | Command |
|-----------|---------|
| Branch polluted after bad merge | `npm run recover:foundation` on clean worktree, then re-cut `feature/*` |
| Only need anchor files | `npm run recover:foundation -- --dry-run` first |
| Stable branch drift | `npm run recover:stable` |

## AI agent rules

- Do not commit to `main` unless user requests promotion.
- Do not force-push `frontend-stable-foundation` or foundation tags.
- After intentional baseline advance, user updates anchor via promotion flow — not ad-hoc doc edits alone.
