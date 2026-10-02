# Coordinated playlist release

Status: prepared locally; not committed, deployed, or migrated. This document
is an execution checklist, not evidence that the steps have been completed.

## Why ordinary deployment order is unsafe

The new API calls `mutate_playlist_tracks` and requires playlist revisions.
The existing API writes directly and uses the old slug-only conflict target.
The migration removes that conflict target and revokes direct track writes.
Neither database-first nor application-first is a compatible rolling release.
Do not deploy this isolated worktree's older base to production.

## Preconditions

1. Capture the current production deployment and exact source commit. Reconcile
   only the playlist diff onto that source. Preserve newer committed work and
   separately account for uncommitted edits, especially ImmersivePreviewModal.
2. Run the focused tests and connected playback regressions on the reconciled
   candidate. Build that exact candidate. The earlier worktree test results do
   not validate a later merge or build.
3. Run `scripts/playlist-contract-tests/production-preflight.sql` against the
   configured Frontend project. It reads schema and aggregate counts only.
   The migration's guarded identity validation remains authoritative; the
   preflight is not an exhaustive data validation or a concurrency proof.
4. Rehearse on a disposable PostgreSQL database with multiple connections:
   concurrent writes at the same revision must yield one committed change and
   one conflict; ownership failures must leave all rows unchanged. PGlite's
   single-connection tests do not meet this requirement. The native 17.6 rehearsal
   below passed on the isolated candidate; repeat it if the migration changes.
5. Verify the candidate with signed-in browser accounts on a test database.
   No test playlist or user data should be written into production implicitly.

## Write cutover required before production application

A shared server gate is implemented locally: `PLAYLIST_WRITES_PAUSED=1`
returns 503 with no-store and Retry-After from all six mutation methods.
It leaves GET and authentication checks intact. This deployment-local flag
does not stop old deployments, direct database writers, or already admitted
requests; it is not a distributed drain mechanism. The gate must first be
released as a bridge on the CURRENT schema-compatible application, before
deploying the new playlist contract. Bridge deployment and drain verification
are still outstanding. Do not ask users to stop editing as a substitute.

The bridge must include visible failed-save handling for existing clients;
older clients that silently swallow failed requests require an explicit
compatibility review. Do not claim that a 503 alone preserves their local edits.

Once the bridge and drain procedure are rehearsed:

1. Enable the gate on the currently serving application and verify every
   playlist mutation method is blocked. Drain in-flight writers before schema
   mutation. Account for any other database writers or active old deployments.
2. Apply only the reviewed playlist migration, transactionally. Do not bulk
   push unrelated pending migrations. On validation or lock-timeout failure,
   keep the old schema and investigate; do not bypass the guards.
3. Verify the new constraint, revision column, service-only function execution,
   and revoked direct writes. Wait for PostgREST to expose the new function.
4. Activate the reconciled API/client candidate while the write gate stays on.
   Verify authenticated reads and function availability, then release the gate.
5. Verify cross-release same-slug entries, exact playback URLs, persisted order
   after a second-session reload, stale revision conflicts, and denied access
   to another user's playlist. Old revisionless clients must receive 409.
   Do not force-reload an active listening session to update its client.

## Failure handling

Before migration: keep or restore the existing application after resolving the
gate. After migration: retain a schema-compatible API and keep writes gated
while repairing forward. Do not restore the old application against the new
schema. Do not recreate the old unique constraint after cross-release entries
exist, or delete those entries to make rollback possible.

## Browser/device acceptance still outstanding

Check both My Music and Playlist Detail, the modal's add/save controls, Singles,
Features, Albums, and Mixtapes & EPs. Include a synthetic future album in the
test database; missing production Albums are not a failure. Confirm natural
track progression, audible start, seek, and continued playback while saving or
reordering playlists. Browser automation is not physical-device listening;
record device/browser and observed results separately.

## Recorded verification, 2026-10-01

- Native PostgreSQL 17.6, three independent connections, synthetic accounts only:
  four scenarios passed in `scripts/playlist-contract-tests/postgres-rehearsal.mjs`.
  The test observed the blocked backend through `pg_blocking_pids`, rather than
  assuming simultaneous requests exercised the row lock. Cases cover competing
  additions, reorder/removal, independent playlists, wrong owners, role grants,
  and migration timeout rollback followed by successful guarded repair.
- The runtime was installed outside the app in `/private/tmp/playlist-pg-runtime`.
  A fresh cluster bound only to loopback, then was stopped and removed. No hosted
  URL or production data is accepted by the rehearsal script. Its launcher uses
  the [embedded-postgres API](https://github.com/leinelissen/embedded-postgres).
- Hosted Frontend read-only ownership comparison: 10 matched product/user pairs,
  zero library-only, zero entitlement-only, and zero active product entitlements
  outside their date window. Database authority row: DUAL_VERIFY. This is not
  proof of the production environment override or application cache contents.
- Hosted membership and collector-ownership tables contained zero rows. Those
  account types therefore have local fixture coverage, not live tier coverage.
- The tracked playlist patch passed `git apply --check` against the current shared
  working tree at HEAD `9d7f06c834a7277392ca61d73262912a2109dd9d`, including its
  uncommitted edits. Nothing was applied there. This checks patch compatibility,
  not runtime compatibility or the untracked additions.
- Vercel's current production deployment was Ready:
  `dpl_JBUkjg4U9zSfdEaezea5fS49D2oW`,
  `https://artist-platform-fx0ap2sie-eellian-morrows-projects.vercel.app`,
  created 2026-10-01 16:58:43 America/Chicago. Source identity still needs verification
  before reconciliation and deployment. This is an existing deployment, not this fix.
- Browser discovery returned no connected browser. Signed-in browser checks,
  audible physical-device checks, bridge release/drain rehearsal, candidate build,
  commit, production migration, and deployment remain outstanding.

Repeat the native rehearsal (requires the separately installed runtime):

```sh
PLAYLIST_POSTGRES_MODULE=/private/tmp/playlist-pg-runtime/node_modules/embedded-postgres/dist/index.js \
  node scripts/playlist-contract-tests/postgres-rehearsal.mjs
```
