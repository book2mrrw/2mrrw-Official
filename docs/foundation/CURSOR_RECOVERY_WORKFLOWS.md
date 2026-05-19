# Cursor Recovery Workflows

Copy-paste commands for frontend foundation recovery in Cursor (terminal) or VS Code tasks.

## Quick reference

| Goal | Command |
|------|---------|
| Full local recovery | `npm run recover:foundation` |
| Dry-run (no changes) | `npm run recover:foundation -- --dry-run` |
| Restore stable branch | `npm run recover:stable` |
| Safe rollback guide | `npm run recover:rollback` |
| Verify only | `npm run verify:foundation` |
| Production deploy | `npm run recover:deploy -- --deploy` |
| Local snapshot zip | `npm run snapshot:foundation` |

Canonical anchor: `docs/foundation/recovery-anchor.json`

## Workflow A — “Something looks wrong locally”

```bash
git status
npm run recover:foundation -- --dry-run
npm run recover:foundation
npm run dev
```

Compare http://localhost:3000 with https://artist-platform-silk.vercel.app

## Workflow B — Dependency or lockfile corruption

```bash
npm run recover:foundation -- --force
```

`--force` restores `package.json` and `package-lock.json` from the anchor commit and runs `git reset --hard` on the stable branch. **Discards uncommitted work.**

## Workflow C — Stable branch out of sync

```bash
npm run recover:stable -- --force
npm run recover:foundation
```

## Workflow D — Bad production deploy

```bash
npm run recover:rollback
```

1. Promote last green deployment in Vercel (fastest).
2. Then locally: `npm run recover:foundation` and `npm run recover:deploy -- --deploy` only after `verify:foundation` passes.

## Workflow E — Verify before any PR or deploy

```bash
npm run verify:foundation
```

## Workflow F — New machine / Cursor reinstall

```bash
git clone <repo>
cd artist-platform
cp .env.example .env.local
# fill keys in .env.local
npm run recover:foundation
```

Or restore from snapshot — see `FRONTEND_LOCAL_RECOVERY.md`.

## VS Code / Cursor tasks

Open Command Palette → **Tasks: Run Task**:

- Verify Frontend Foundation
- Recover Frontend Foundation
- Recover Frontend Foundation (dry-run)
- Restore Stable Foundation Branch
- Foundation Deploy (requires --deploy)
- Create Foundation Snapshot

## Flags reference

| Flag | Scripts | Effect |
|------|---------|--------|
| `--dry-run` | recover:*, verify:* | Print steps only |
| `--force` | recover:foundation, recover:stable | Hard reset / branch -f / restore lockfiles |
| `--deploy` | recover:foundation, recover:deploy | Run `deploy:prod` after gates |
| `--skip-git` | recover:foundation | Skip checkout; verify current tree |
| `--quick` | verify:foundation | Skip lint + build |
| `--local` | recover:rollback | Checkout anchor commit locally |

## Do not

- Run `recover:deploy -- --deploy` without passing `verify:foundation`
- Use `--force` on shared remote branches
- Commit `.env.local` or print secret values in terminal logs
