# Phase 5.1.5 — New Checkpoint Identifier

**Created:** 2026-05-30T19:23Z (local)  
**Command:** `npm run recover:checkpoint -- "Phase 5.1.5 recovery baseline synchronization"`

## Checkpoint identifier

| Field | Value |
|-------|-------|
| **Tag** | `frontend-checkpoint-20260530-1423` |
| **Commit** | `bac9eb71f93dcbc0bee4099bf6d80ddaac29e049` |
| **Short** | `bac9eb7` |
| **Branch** | `main` |
| **Manifest** | `docs/foundation/checkpoints/checkpoint-20260530-1423.md` |

## Sacred foundation (unchanged mechanism)

| Tag | Commit | Role |
|-----|--------|------|
| `foundation-stable-v1` | `ce6ae20` | Immutable UI origin |
| `foundation-stable-v2` | `42a4bd9` | Historical |
| `foundation-stable-v3` | `bac9eb7` | **Promoted operational baseline** |

## Recovery commands

```bash
# Milestone checkpoint (this promotion)
git fetch --tags origin
git checkout frontend-checkpoint-20260530-1423
npm ci
npm run verify:foundation

# Full foundation restore (canonical)
npm run recover:foundation

# Operational tag directly
git checkout foundation-stable-v3
npm ci
npm run verify:foundation
```

## Push (operator, when approved)

```bash
git push origin foundation-stable-v3
git push origin frontend-checkpoint-20260530-1423
```

**Note:** Tags were updated locally with `-f` on `foundation-stable-v3`. Coordinate with team before pushing rewritten tag to remote.
