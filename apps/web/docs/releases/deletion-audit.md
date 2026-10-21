# Release deletion audit — 2026-10-20

Baseline: origin/main 78307732. Production inspected: dpl_Aj7dosr98qpuMnvSx1af834KFLb1. Existing main checkout contains unrelated uncommitted work and is preserved. Audit completed before implementation.

## Source of truth and relationships

Live Supabase metadata (qvfbgkbgczyqrglvgyqr), inspected using explicit read-only SQL transactions, confirms:

- `releases`: wizard lifecycle, slug, type, cover, publication schedule. Types: single, feature, album, ep, mixtape, deluxe. Status: draft, scheduled, published, archived.
- `tracks.release_id`: wizard recordings, ON DELETE CASCADE. `release_drafts.release_id`: saved wizard payload, ON DELETE CASCADE.
- `products`: public/commerce projection, linked by release_id, plus standalone legacy products. Product types single/feature/album; EP/mixtape distinguished by metadata.release_category and the mixtapes-and-eps folder.
- `catalog_tracks.product_id`: storefront track projection, ON DELETE CASCADE; track_id links recordings; album_slug supports legacy rows.
- Purchases, library_items, collector_ownerships, gift_transactions, credits/collaborators, audio_visuals and track visuals retain references. Several product foreign keys are RESTRICT. Hard deletion would destroy history or fail.
- `public_products` view selects active products; scheduled activation updates both release and product. No independent search index/materialized release view was found. Artist/catalog/search/discovery views derive from catalog client state; a separate Control System transport exists and can contribute fallback/hydration rows.

## Confirmed failures

The homepage uses InlineReleasesManager, whose release list has only Edit/View actions. The separate /admin/releases screen uses ReleasesManager, whose DELETE rejects published wizard records, stages draft_deletion_jobs, or sets catalog active=false. PATCH archive is a different reversible operation. Inactive catalog rows remain in management. Sync/ingest can upsert active=true; no persistent deletion boundary exists.

N.2.K: product df4b923b-6905-404e-8def-9819fdb5ccf4, release 267ab502-4eaa-4127-aea3-7aff16f4f6bd, slug n-2-k-6. Both canonical still fields hold images/features/n-2-k-6/n-2-k-6.jpeg. Its cover_url is a discovery URL. catalogCoverUrl classifies every images/ path as bundled, sending the canonical uploaded still to the website: live HEAD returned 404. The R2 URL returned 200 image/jpeg. Existing tests accepted the URL's shape without checking its origin. The modal discovery path is distinct; an unauthenticated request returned 401, so authenticated modal rendering was not verified during audit.

Empty DB catalogs and empty SSR categories can fall back to bundled releases. Mounted non-single snapshots refresh only after same-document admin mutations. Service worker caches icons/fonts/images/optimized images, not release API responses. Next ISR needs invalidation. Native mobile uses the platform catalog API and React Query (five-minute staleTime); its shipped-client behavior is separate from PWA behavior.

## Proposed lifecycle and boundaries

Delete draft and delete published release both establish an explicit, persistent soft-delete tombstone; retain authoritative records, draft payloads, tracks, shared audio/artwork, purchases, credits and audit history. There is no automatic asset garbage collection. This differs from unpublish (reversible visibility change) and archive (administrative retention without a deletion marker). No undelete UI is proposed. A privileged recovery procedure can be designed from retained records if required; normal writes must not undo deletion.

Use one service-only transactional RPC, attributed to a verified administrator, to lock release then product and mark linked records. Add immutable deletion state, RLS restrictions and write guards against sync/ingest/publish resurrection. Exclude tombstones from list/detail/catalog/media/playlist/hydration paths; client refreshes must replace snapshots including empty arrays. Database failure must not masquerade as successful deletion.

Affected owners: releases/products and their policies/triggers; admin DELETE and the inline manager list; deletion actions removed from the alternate dashboard per administrator clarification; canonical catalog reader, fallback handling, media URL resolver, release availability and playback/preview boundary, catalog hydration, playlist projection, client catalog refresh and radio. No R2 object, recording or historical relationship is to be deleted.

## Risks, dependencies, rollback and verification plan

Additive database migration must precede application rollout. Rehearse SQL with synthetic data in disposable PostgreSQL; never delete real releases or create destructive production test fixtures. Test single/feature/album/EP/mixtape and drafts, duplicate requests, concurrency, failed writes, authorization, linked/legacy records, history/media retention, sync reactivation rejection, direct read policies, empty catalogs and artwork routing. Verify build/lint and deployed read-only routes/artwork separately. Browser tests must cover confirmation/cancel/failure, mobile/desktop/tablet viewport layouts; physical-device/PWA/native installed-app behavior cannot be inferred from these tests.

Before any real deletion, rollback can use the previous immutable deployment. After any real deletion, use a tombstone-aware deployment or a forward fix: the old application contains unsafe bundled fallback readers. Preserve additive columns and tombstones. Do not drop the migration or clear markers during ordinary rollback: that would resurrect deleted releases. Long-lived/offline clients and already-issued media URLs cannot be remotely erased; active clients must reconcile on reconnect/focus and polling, and server checks govern new requests. Purchases/history remain historical rather than advertised availability.

Authorization: user explicitly authorized implementation, commit, push and deployment. Individual deletions require explicit administrator confirmation. Storage destruction, actual-release deletion for validation, and broad unrelated migration replay are excluded.

## Scope clarification and connected cleanup

The administrator explicitly requested deletion controls only in the inline manager. The alternate dashboard no longer exposes its old delete/takedown/swipe actions. Already-confirmed legacy draft jobs now call the same retained-media transaction with a draft-only precondition, avoiding the old storage-deletion race. Recovery hydration uses the authoritative catalog and reports missing references rather than fabricating playable records. Active collection/recently-played and playlist projections consume the deletion snapshot; historical database records are retained.

## Verification before rollout — 2026-10-21

- 157 targeted application tests passed: deletion interaction simulations, route denials/errors, catalog emptiness, artwork origin, publication/upload, mobile projection, ownership and email-bound rights. Includes 27 new lifecycle/catalog/route tests.
- Disposable PostgreSQL 17.10: 22 scenario groups passed across every requested release type, linked and legacy records, restrictive read policies, service-only execution, retained tracks/drafts/history, failure rollback, concurrent requests, alias identities and identical UUIDs in different tables. Production fixtures were not created or deleted.
- Local production build passed using Next's webpack mode. Default local Turbopack was blocked by the isolated checkout's external dependency symlink; remote deployment uses normal dependency installation and must be checked separately.
- ESLint: zero errors; existing React-hook/image warnings remain in connected files. Whitespace diff check passed.
- Browser runtime discovery returned no connected browsers. Confirmation/cancellation/failure/concurrency/MFA were tested by executing the real compiled component with mocked hooks and HTTP responses. Browser layout, physical phones/tablets, installed PWA behavior and functional playback have not been verified by these checks.
- The native platform API shares the deletion-aware catalog. No standalone native application binary is shipped by this web deployment; an already-running older native client reconciles when it fetches again. The separate in-progress mobile repository was not modified.

## Production database verification

Migration 20261020210000 applied and recorded atomically through the linked Supabase management connection. Read-only verification confirmed: deletion_count=0, deleted_release_rows=0, deleted_product_rows=0; N.2.K remains active; anon/authenticated cannot execute delete_release; service_role can execute it but cannot DELETE the tombstone ledger. No R2 operation was performed. The final RPC keeps caller-provided release/product identity namespaces distinct, including identical UUIDs across tables.

Concurrent main update af8cf653 (interruption recovery and album recording identity) was preserved by a clean rebase. All 27 new deletion tests plus its 44 recovery tests passed together after integration (71/71). The earlier 157-test targeted run and database rehearsal are distinct evidence, not additional device tests.
