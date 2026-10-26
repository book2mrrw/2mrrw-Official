# GLYPHS lyrics release rollout

The user authorized commit and production deployment after the local implementation phase. The [Phase report](PHASE_REPORT.md) and original evidence remain a historical pre-release snapshot; its uncommitted/not-deployed status describes that earlier handoff.

## Source and deployment lineage

The starting lyrics baseline was `56636d21bdc233aabdd20a04e338926c7d532aed`. Production inspection found Vercel deployment `dpl_E6QD7okRGWQzvS5TzRvNgAC7HpoJ`, serving the pricing readiness fix `9685c0bdfe18d197d857710d911f132a4deb5ec3`, ahead of GitHub main. The lyrics branch was fast-forwarded to that live commit before creating this release, preserving its five changed files. The app target is Vercel `artist-platform`, project `prj_jlnukzpNHMg72KdbsYFG7ZkCvrgI`, root `apps/web`, production domains `www.2mrrw.com` and `2mrrw.com`.

## Database rollout, verified 2026-10-26

Frontend Supabase project: `qvfbgkbgczyqrglvgyqr` (`2MRRW-Frontend Project`). Only `20261024010000_private_lyric_working_drafts.sql` was applied, together with its exact migration-history entry in one transaction. No wholesale `db push` was used. Source SHA-256: `84f609257a2a7934b9391a7629fb42a09dffa5b2b8ac22f1b55544f8cb78004a`.

The three prerequisite credit/lyric migration records and publication RPC were present. The target table, functions and history entry were absent before application. Authenticated Supabase CLI applied the additive migration successfully. Published lyrics were not backfilled or changed.

Live verification executed draft save/read, account isolation, stale-revision rejection, changed-published-baseline rejection, foreign-recording rejection, and actual anon/authenticated RPC denial inside an explicitly rolled-back transaction. It refused to touch a target that already had a real working draft. After rollback, draft row count was zero. RLS was enabled; anon/authenticated table reads were denied; service_role execution was granted. Catalog counts remained releases 13, products 29, tracks 8 and catalog_tracks 30.

Review [readback](evidence/live-migration-readback.json) and the exact [verification SQL](evidence/live-migration-verification.sql). No permanent test draft remains. This verifies the database contract, not a signed-in browser workflow or audible synchronization.

## Release validation and limits

Release checks include the existing live pricing tests, shared lyrics/credits/media contracts, authoring/modal and PostgreSQL workflows, playback/core regressions, and the production webpack build. Final release logs and deployment identity are recorded in the deployment handoff. Prior known lint/auth inventory failures remain documented in the Phase report.

The browser connection exposed no browser during implementation. Actual touch, visual layout, codecs, signed-in authoring and audible synchronization remain separate unverified checks. No native player integration is claimed for the current Capacitor app.

## Rollback

Redeploy the preceding application revision if required. Retain the additive private table, service-only functions, migration-history entry and any real saved drafts. Older application code can ignore them. Do not drop drafts or mark the migration reverted to roll the UI back. Device recovery remains explicitly labelled when server saving is unavailable. Draft persistence is separate from public Save Lyrics/publication.
