# Frontend Local Recovery

Restore the foundation system on a new Mac, Cursor reinstall, or VS Code machine without relying on uncommitted local state.

## What gets snapshotted

`npm run snapshot:foundation` creates:

- `storage/frontend-recovery-snapshots/foundation-snapshot-<commit>-<timestamp>.tar.gz`
- Matching `.manifest.json` with anchor commit and path list

Included paths:

- `package.json`, `package-lock.json`
- `docs/foundation/` (anchor JSON, playbooks, baseline)
- `scripts/recovery/` (orchestrators + shell wrappers)
- `.cursor/rules/frontend-foundation.mdc`
- `.env.example` (names only — no secrets)

Large zips are gitignored (`storage/frontend-recovery-snapshots/*.tar.gz`).

## Create snapshot (source machine)

```bash
npm run snapshot:foundation
```

Copy the `.tar.gz` and `.manifest.json` via secure transfer (AirDrop, encrypted drive, 1Password attach, etc.).

## Restore (target machine)

```bash
git clone <your-repo-url> artist-platform
cd artist-platform
tar -xzf /path/to/foundation-snapshot-*.tar.gz
cp .env.example .env.local
# Edit .env.local — fill keys, never commit
npm run recover:foundation
```

If you have the full git repo, prefer:

```bash
npm run recover:stable
npm run recover:foundation
```

## Cursor / VS Code setup

1. Open folder `artist-platform`
2. Install recommended extensions (if any in `.vscode/extensions.json`)
3. Run task: **Verify Frontend Foundation**
4. Terminal: `npm run dev`

## Branches to fetch

```bash
git fetch origin
git checkout frontend-stable-foundation
git checkout frontend-feature-dev
```

Branch purposes: see `FRONTEND_RECOVERY_PROTOCOL.md`.

## Env on new machine

Compare key **names** only:

```bash
npm run recover:foundation -- --dry-run
```

Missing `.env.local` keys are warned; values are never printed.

## Without git (disaster)

1. Extract snapshot tarball to empty directory
2. `npm ci`
3. Add `.env.local` from your secret store
4. `npm run verify:foundation`

You still need the full `src/` tree from git for a runnable app — snapshots protect **foundation pins and recovery tooling**, not the entire application source.
