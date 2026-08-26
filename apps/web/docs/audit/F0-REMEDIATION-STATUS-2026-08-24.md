# 2MRRW F0 Remediation Status

Generated: 2026-08-24; updated: 2026-08-25

## Decision

F0 audit coverage remains **34/34 domains accounted for, 0 PARTIAL, 0 UNTOUCHED**.

F0 is **not closed**. Repository remediation has closed five of the six priority engineering defects selected after the forensic audit. An isolated Supabase data branch and protected Vercel preview now prove deployability and anonymous-access boundaries, but they do not substitute for a dated physical-backup restore drill or the remaining cross-provider recovery evidence.

## Priority remediation ledger

| Finding | Repository status | Evidence | Remaining production proof |
|---|---|---|---|
| Inconsistent admin guarding | RESOLVED | Canonical AAL-aware guard is applied across the admin API inventory; `F0-ADMIN-1` and `F0-ADMIN-2` pass; protected preview returns 401 anonymously for `/api/admin/releases` | Live authenticated AAL1-denied/AAL2-admitted canary |
| 102 lint errors | RESOLVED | `npm.cmd run lint` exits 0 with 0 errors and 260 warnings | Browser/device regression; warning-budget reduction is quality work, not a closed-error exception |
| Missing account-deletion orchestration | DEPLOYED / EXECUTION GATED | Durable leased saga, export encryption/delivery, processor receipts, retention classification, exact-key storage cleanup, revocation, Auth-last deletion, immutable evidence sealing; F0 lifecycle tests pass; the isolated branch and Production expose 12/12 service lifecycle RPCs and deny anonymous worker execution; Production application route is live and returns 401 anonymously | Complete authenticated non-destructive canaries, approve legal retention, validate export-key recovery, then explicitly enable execution |
| Inadequate disaster-recovery proof | PARTIAL PRODUCTION EVIDENCE | Versioned platform DR runbook and fail-closed readiness verifier exist; Supabase branch `sczcxkqqwmjhpetxjiec` is isolated and data-cloned; protected Vercel preview deployed successfully against it; lifecycle schema drift was reconciled and API authorization behavior certified in both branch and Production | Physical-backup/PITR restore to a distinct project, full catalog migration/RLS certification, R2 checksum restore, Stripe replay, and measured RPO/RTO evidence |
| Fragmented observability | IMPLEMENTED | Structured redacted server-event envelope and correlation instrumentation cover lifecycle, upload, gifting, Stripe, publication, HLS recovery, entitlement revocation, and storage cleanup | Central-sink/alert configuration and incident reconstruction drill |
| Nondurable bulk-gift limiter | RESOLVED | Durable atomic fail-closed limiter; `F0-RATE-1` through `F0-RATE-3` pass | Distributed production concurrency canary |

## Verification snapshot

| Gate | Result |
|---|---:|
| ESLint | PASS — 0 errors, 260 warnings |
| Next.js production build | PASS — compiled, typechecked, and generated 77/77 static pages |
| Auth/security | PASS — 192/192 |
| Playback Core | PASS — 142/142 |
| Release lifecycle | PASS — 23/23 |
| Playback physical convergence | PASS |
| `git diff --check` | PASS; Git reports line-ending normalization notices only |
| DR readiness | NOT CERTIFIED — 13 pass, 9 fail in the local process |
| Protected preview deployment | PASS - deployment `dpl_1FmUK59PGSLvn6t5wPMNfk63FTyq` reached READY and generated 77/77 pages |
| Preview read-only canaries | PASS - `/`, `/api/public/events`, and `/api/catalog/releases` returned 200; `/api/admin/releases` and `/api/account/lifecycle` returned 401 anonymously |
| Lifecycle worker contract, isolated branch | PASS - `lease_token` and `max_attempts` present, 12/12 service RPCs visible, anonymous worker call denied with 401 |
| Lifecycle worker contract, Production DB | PASS - migration 49 reconciled inherited drift; `lease_token` and `max_attempts` present, 12/12 service RPCs visible, anonymous worker call denied with 401 |
| Production deployment | PASS - deployment `dpl_7PiLbNnE9qG5FqjR8cANz9ZGKqn4` reached READY and was aliased to `https://www.2mrrw.com` on 2026-08-25 |
| Production read-only canaries | PASS - `/`, `/api/public/events`, and `/api/catalog/releases` returned 200; `/api/admin/releases` and `/api/account/lifecycle` returned 401; `/api/cron/account-lifecycle` returned 403; no 500-level deployment logs were present |

The nine DR failures are five deployment secrets unavailable to the local verifier plus four evidence-only drill gates. The verifier intentionally cannot turn those checks green from repository inspection.

## Isolated preview evidence

- Git branch: `f0-dr-preview`, published at the same committed revision without committing the dirty working tree.
- Supabase branch: `sczcxkqqwmjhpetxjiec` (`f0-dr-20260824`), isolated from production and created with data.
- Vercel deployment: `dpl_1FmUK59PGSLvn6t5wPMNfk63FTyq` (`https://artist-platform-e4lih2oop-eellian-morrows-projects.vercel.app`).
- Supabase credentials are scoped only to Vercel Preview deployments from `f0-dr-preview`.
- `ACCOUNT_LIFECYCLE_EXECUTION_ENABLED=false` in that preview.
- Production deployment and Production environment bindings were not changed.

The Supabase organization still lists only `2MRRW-Frontend Project` and `2MRRW-Control-System` as projects. Therefore, the branch clone is valid staging evidence but is not recorded as proof of a physical-backup restore into a distinct project. Its migration ledger is also incomplete relative to the repository even though lifecycle tables exist. Migration 49 now provides a forward-only source-controlled reconciliation for the inherited migration-41 drift; complete ledger and RLS certification across all platform tables remains open.

## Lifecycle schema reconciliation evidence

- Migration: `20260824000049_reconcile_account_lifecycle_worker_rpcs.sql`.
- Initial branch execution failed closed because both `lease_token` and `max_attempts` were absent; the transaction made no changes.
- OpenAPI comparison proved the same prerequisite and RPC drift existed in Production.
- The revised migration adds the missing columns and bounded-attempt constraint, changes the Auth foreign key to `on delete set null`, restores the three fenced worker RPCs, limits execution to `service_role`, and reloads the PostgREST schema cache.
- Revised migration succeeded first on `f0-dr-20260824`, then on Production on 2026-08-25.
- Post-migration verification: both environments expose 12/12 service lifecycle RPCs; an anonymous no-match invocation of `finish_account_lifecycle_step` returns 401 `permission denied`.
- Account lifecycle execution remains disabled; no export or deletion workflow was started.

## Production application deployment evidence

- Deployment: `dpl_7PiLbNnE9qG5FqjR8cANz9ZGKqn4` (`https://artist-platform-8bwqlu440-eellian-morrows-projects.vercel.app`).
- Production alias: `https://www.2mrrw.com`.
- Vercel build compiled and typechecked successfully and generated 77/77 static pages.
- Post-deployment public/catalog canaries returned 200.
- Anonymous admin and account-lifecycle requests returned 401; the lifecycle cron returned 403 without its service credential.
- A post-canary query found no 500-level logs for the deployment.
- Destructive lifecycle execution remains gated and was not exercised.

## Account-lifecycle safety state

Account deletion execution remains disabled unless `ACCOUNT_LIFECYCLE_EXECUTION_ENABLED=true`. This is intentional. Enabling it before schema certification, external processor canaries, retention approval, and export-key recovery validation would convert an implemented workflow into an unproven destructive production capability.

## Closure conditions

F0 can be marked closed only after all of the following evidence is attached:

1. Successful isolated Supabase recovery with migration/RLS certification.
2. R2 inventory and sampled checksum restoration.
3. Duplicate Stripe replay with exactly-once business effects.
4. Measured RPO/RTO timeline within the documented objectives.
5. Fresh AAL1 denial and AAL2 admin admission against the deployed build.
6. Account export/deletion canaries and legal retention approval before lifecycle execution is enabled.
7. Central observability sink and alert routing proof sufficient to reconstruct one cross-provider incident.

Until those conditions pass, Slice 1D remains blocked by the F0 verification gate even though the selected repository defects are structurally remediated.
