# Frontend Foundation Tag Strategy

Operational symmetry with the control repo: **checkpoints** for milestones, **sacred tags + stable branch** for disaster baseline.

## Sacred frontend foundation

| Mechanism | Value | Notes |
|-----------|-------|-------|
| Operational anchor | `41351d8` | See `docs/foundation/recovery-anchor.json` |
| UI origin (immutable) | `ce6ae20` | `foundation-stable-v1` — cinematic baseline before recovery bundle |
| Stable branch | `frontend-stable-foundation` | Tracks operational anchor; **do not force-push** |
| Sacred tag v1 | `foundation-stable-v1` | Annotated tag on `ce6ae20`; **never move** |
| Sacred tag v2 | `foundation-stable-v2` | Annotated tag on operational anchor (`41351d8`); full recovery |

`foundation-stable-v1` mirrors backend naming for the original UI lock. `foundation-stable-v2` is the promoted operational baseline (recovery scripts + same UI). `recover:foundation` reads `recovery-anchor.json`, not the v1 tag directly.

## Experimental checkpoints

| Item | Pattern |
|------|---------|
| Tag | `frontend-checkpoint-YYYYMMDD-HHMM` |
| Manifest | `docs/foundation/checkpoints/checkpoint-YYYYMMDD-HHMM.md` |
| Command | `npm run recover:checkpoint` |

Checkpoints are **not** foundations. They never replace `foundation-stable-v1` or move `frontend-stable-foundation`.

## Promotion discipline

Promote to a new sacred tag (e.g. `foundation-stable-v2`) only when:

1. Production smoke passes on the candidate commit
2. `verify:foundation` and guardrails pass
3. Control repo anchor / recovery bundle updated
4. Team explicitly approves (no automatic promotion)

## Recovery order

1. Prefer `npm run recover:foundation` (reads `recovery-anchor.json`)
2. Or `git checkout foundation-stable-v1` + `npm ci` + `npm run verify:foundation`
3. For a milestone only: `git checkout frontend-checkpoint-…`

## Create sacred tag (operators, once)

If `foundation-stable-v1` is missing:

```bash
git fetch --tags origin
git tag -a foundation-stable-v1 ce6ae20 -m "Frontend sacred foundation v1 (anchor ce6ae20)"
git push origin foundation-stable-v1
```

Do **not** move the tag if it already exists on a different commit.

## Related

- Control: `2MRRW_RECOVERY_SYSTEM/RECOVERY_GUIDES/FOUNDATION_TAG_DISCIPLINE.md`
- [`FRONTEND_RECOVERY_PROTOCOL.md`](FRONTEND_RECOVERY_PROTOCOL.md)
