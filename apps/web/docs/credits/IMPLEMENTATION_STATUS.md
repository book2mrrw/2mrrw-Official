# Credits implementation and verification — 2026-10-21

## Scope and cause

Public credit readers discarded publisher-shaped attribution and substituted global names. Release and recording attribution did not have a shared scoped contract. The old editor omitted saved credits and identifiers; publication and draft persistence could partially overwrite data. No private editorial allocation schema existed in the actual frontend database. These are source and schema findings; production administrator rendering has not been directly observed.

The implementation centralizes legacy normalization and public projection, introduces private credit groups and UUID-backed contributor assignments, and commits source metadata, catalog projections and lifecycle changes through revision-checked PostgreSQL transactions. Contributor directory creation is explicit; same names do not imply the same person. Writer and producer totals are independent integer hundredths. Legacy names, unknown roles, identifiers, financial collaborators and recording overrides are preserved. Raw draft snapshots retain incomplete input; publication validates canonical allocations. Percentages and private directory fields are excluded from public attribution.

The upload wizard and existing release editor share the credits editor. The existing editor now loads and saves artist, supported release type, schedule, credits, UPC, recording title and ISRC; its three save paths carry revisions. Album release/recording scope is selectable independently of playback. Fresh reads handle loading, empty/error/retry, stale responses and catalog invalidation. Cross-family release type changes with uploaded media are rejected because asset relocation requires a separate media lifecycle operation.

## Migration result

Authenticated Supabase CLI applied `20261021010000` and `20261021020000` atomically to frontend project `qvfbgkbgczyqrglvgyqr`, including their migration history records. Both copyable SQL files are in `supabase/migrations`; see [ROLLOUT.md](ROLLOUT.md) for order, hashes and nondestructive rollback.

Live RPC checks ran under actual `service_role` and `anon` roles in explicit rollback transactions. Consecutive returned revisions, stale-save denial, invalid allocation rollback, actual anonymous permission denial, publication with existing metadata, and final publication failure rollback all passed against real triggers. No permanent test credits or contributors remain. Counts before/after: releases 13, products 29, tracks 8, catalog tracks 30, contributors 0, financial collaborator rows 0. Both new allocation tables contain zero rows after verification. The checked-in verification SQL and sanitized results document these checks.

## Source isolation

The original checkout remains untouched. Implementation began in `credits-implementation` atop the supplied dirty baseline. Deployment was reconstructed in `credits-deployment` atop current remote main `280b4524a4d2a9b280e8f870b4b8087bf0476db9`, applying only task changes and the two required audio-job helper dependencies. Existing remote release deletion guards and playback changes were preserved. No wholesale dirty-worktree staging is appropriate in the original implementation checkout.

## Verification and limits

- Focused Node tests: 130 passed (credits normalization, scope, identifiers, exact allocations, API guards, draft queue, unfinished drafts, publisher and upload regressions).
- PostgreSQL engine fixture built from captured live columns and constraints: 19 checks passed, including atomic publication, permissions, inheritance, independent allocations, explicit clears, rollback and concurrent revisions. Fixture checks do not reproduce all production triggers; separate live rollback checks cover actual RPC execution.
- Before upstream reconciliation: 13 Chromium component checks and 6 PostgreSQL-backed existing-editor browser checks passed. These used fixture administrator/authentication and media I/O. They do not prove a signed-in production administrator, media upload or playback.
- Connected test sweep on the deployment candidate: 471 passed, 8 failed, 479 total before the final unfinished-draft regression was added. All eight failures reproduce in a clean checkout of remote main: stale route inventory, four Broadcast routes missing the source test's authority markers, and six cart fixture failures because mocks lack the already-used `.is()` operation. These unrelated failures are not claimed fixed.
- New credits modules, components and routes pass ESLint. Production webpack build passed. Local runtime must use a configured public Supabase URL; the supplied local file has that field empty and a configured server URL. The final build supplies the same URL through process environment without changing credential files. The built attribution, contributor and existing administrator detail endpoints each returned 401 without authentication.
- Existing GitHub Web CI was already failing in pnpm setup on remote main, before source lint/tests/build. Vercel's preceding production deployment was successful. Deployment identity and final remote checks are reported in the completion message.
- Production authenticated edit/create/publish/reopen, checkout, owned playback, actual preview playback and physical devices remain unverified. HTTP status and build success are not playback evidence.

Expected benefit: accurate scoped attribution, reusable contributors, private exact allocations, preserved historical metadata and conflict-safe saves. No performance improvement or universal device coverage is claimed.

## Repeat PostgreSQL fixture checks

Install `@electric-sql/pglite` into a temporary directory, set `CREDITS_PGLITE_MODULE` to its `dist/index.js`, and run `node --import ./scripts/register-alias.mjs scripts/test-credits-postgres.mjs` from `apps/web`. It uses the checked-in sanitized schema snapshot, creates a fresh in-memory database and applies both migrations. It never connects to production.
