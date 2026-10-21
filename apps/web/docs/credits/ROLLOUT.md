# Credits database rollout

Target: `qvfbgkbgczyqrglvgyqr` (2MRRW frontend). The two migration files are directly copyable SQL and each contains its own transaction. Apply contract first, atomic publication second. Do not run a wholesale `db push`: this checkout contains unrelated pending historical migrations.

The CLI rollout uses one enclosing transaction for both files and their exact migration-history records. It creates empty private allocation tables, installs service-only functions, and removes ordinary-role directory access. It does not backfill credits, create contributors, change historical identifiers, or touch financial `release_collaborators` data. Storage and encoding preparation precedes the publication transaction; failed publication can leave unreferenced prepared objects but does not partially publish catalog metadata.

Review prerequisites in `frontend-schema-2026-10-21.json` and run `live-schema-inspection.sql` against the intended project. Verify source/catalog counts and migration versions before and after. Validate actual RPC execution inside `BEGIN`/`ROLLBACK`, including permission denial, stale revisions and invalid allocation rollback. Do not insert permanent test contributors into production.

## Rollback

Application rollback: redeploy the preceding application commit. Retain both additive tables, functions, history entries and any administrator-entered allocations. The old application can ignore these additions; rollback does not restore historical unsafe overwrite semantics. Do not drop the new tables after use, delete allocations, reopen ordinary-role access, or mark migrations reverted merely to roll back the UI. A database contract correction should be a reviewed forward migration. Stop editing during an incident and preserve entered data before correction.

## Migration integrity

- `20261021010000_release_credit_contract.sql`: SHA-256 `73928f0cf204543f30c1ffdf766bb3d47c93e124ecc3c1d04642f15e563f894c`
- `20261021020000_atomic_credit_publication.sql`: SHA-256 `c026bfcb6429026fc7d378a34d03e0dbfdf44e314b9318208a4e40f195fa8f97`
