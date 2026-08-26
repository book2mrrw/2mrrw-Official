# 2MRRW Platform Disaster Recovery

Status: implementation readiness only. DR is not certified until a dated isolated restore drill satisfies every gate below.

## Recovery objectives

| Service | RPO | RTO | Canonical recovery source |
|---|---:|---:|---|
| Web deployment | 0 | 15 minutes | Git commit plus immutable Vercel deployment |
| Supabase Postgres/Auth | 15 minutes | 2 hours | Supabase PITR or verified logical backup |
| Private R2 media | 24 hours | 4 hours | R2 versioning/replication plus inventory manifest |
| Redis caches/rate limits | 0 | 30 minutes | Rebuild from Postgres; never restore grants from cache |
| Stripe commerce | 0 | 2 hours | Stripe canonical objects plus idempotent webhook replay |
| HLS derived media | 24 hours | 8 hours | Rebuild from retained masters and durable jobs |

## Incident authority

The incident commander declares recovery mode. A database recovery operator restores data. A deployment operator promotes code. A security operator rotates credentials. No single recovery step may silently grant admin or entitlement authority.

## Mandatory restoration order

1. Freeze deploys and destructive workers, including account lifecycle execution.
2. Preserve logs, affected deployment IDs, database timestamps, R2 inventory, Stripe event IDs, and worker job state.
3. Select a recovery timestamp before the first corrupting write.
4. Restore Postgres/Auth into an isolated project. Never overwrite production as the first restore attempt.
5. Run migrations and read-only E0/E1/F0 certification against the isolated restore.
6. Restore or remap private R2 objects and compare key, size, ETag/checksum, and reference inventories.
7. Rebuild caches from canonical data. Do not restore Redis entitlement grants.
8. Replay Stripe events by event ID through the canonical idempotent handler.
9. Requeue derived HLS work from retained masters; derived output is not canonical truth.
10. Deploy the exact tested commit and run authentication, purchase, playback, upload, scheduled-release, and admin AAL2 smoke tests.
11. Rotate any credential exposed during recovery.
12. Record measured RPO/RTO, discrepancies, evidence hashes, approvers, and follow-up actions.

## Required drill evidence

- Isolated Supabase project identifier and restore timestamp.
- Source backup/PITR timestamp and measured data loss.
- Schema migration and RLS verification results.
- `e0_certify()` 13/13 and the F0 account-lifecycle certification output.
- Row-count and critical-ledger digests for purchases, entitlements, collector ownership, releases, tracks, and lifecycle seals.
- R2 inventory comparison and sampled byte/checksum retrieval.
- Stripe duplicate replay proving exactly-once business effects.
- HLS master-to-derived regeneration proof.
- Fresh admin AAL2 login and denied AAL1 proof.
- Measured recovery start, service-restored time, RPO, RTO, and named approval.

## Stop conditions

Do not cut over when any authority table is missing, an RLS check fails, retained purchase/collector evidence diverges, an R2 object referenced by a published release is absent, webhook replay duplicates effects, or an admin can enter without the configured assurance level.

Backups are not DR proof. Only a successful isolated restoration drill, with retained evidence, certifies this domain.
