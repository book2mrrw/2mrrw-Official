# Playlist identity and ordering repair

Implemented in the isolated `fix/playlist-contract` worktree based on `74ceb04b`.
No production migration, commit, or deployment has been performed.

## Contract

A playlist entry identifies a recording by `(albumSlug or null, trackSlug)`.
The client key is the JSON serialization of that pair. Playback IDs remain
separate; the existing database UUID is preserved. Same-slug tracks from
separate releases coexist, while re-adding the same recording is idempotent.

The API authenticates each request and passes the actor to a service-role-only
SQL function. That function checks playlist ownership, locks the playlist row,
checks the caller revision, and applies add/remove/reorder atomically. Reorder
must contain all current entries exactly once. Direct track-table mutation
privileges are revoked so runtime callers cannot bypass this contract.

Local mutations serialize per user/playlist, carry acknowledged revisions, and
retain visible error state on failure. Late hydration cannot erase newer edits;
interrupted saves remain visibly unsaved. A user can explicitly discard unsaved
edits and reload the server version. This is not an offline automatic retry queue.

Both playlist playback surfaces resolve the same saved identity before queue
creation. Album/EP tracks request release slug plus track slug and retain distinct
queue IDs. Singles/features keep product-only requests. No audio engine, DSP,
queue-completion, autoplay, or active-source lifecycle code was changed.

## Entitlement contract

The user confirmed entitled-only additions. The add API resolves the owning
product (`albumSlug` for a release track, otherwise `trackSlug`) through the
existing server `userCanStreamProduct` service and the authenticated user. Caller
metadata cannot grant access. Denial returns 403; a thrown authority error returns
503 before the playlist transaction. The transaction still enforces playlist
ownership and revisions. Removal and reordering do not require media entitlement.

Picker eligibility uses `resolveContentAccess(...).canAddToPlaylist`, not another
membership/collector tier implementation. The catalog includes Features and
purchased multi-track releases. Playlist Detail now consumes the same hydrated
entitlement hook as My Music. Saved access flags are recalculated for new queues;
the active queue is not rewritten. Streaming and HLS authorization, release
schedules, grant/revocation logic, billing, and entitlement cache policy are unchanged.

Modal save acknowledgements wait for the submitted server writes. Failed saves
remain visibly unsaved; a failed legacy import retains its local entries and
blocks automatic hydration rather than claiming completion. A partially created
server playlist may remain after import failure; this is not an atomic batch import
or an automatic retry mechanism. Explicitly discarding unsaved changes reloads
the server version.

Local verification after entitlement integration: 42 focused playlist tests,
72 connected playback/entitlement tests, and six JSX/hook syntax checks passed.
The HTTP tests mock authenticated identities and entitlement-service responses;
the tier matrix invokes the real client entitlement resolver. These results do
not establish hosted account behavior, concurrent PostgreSQL behavior, or audible
browser/device continuity. Current shared-source entitlement service, music-access,
AuthContext, and release-access files matched the isolated baseline when checked.

## Existing hosted evidence

Read-only checks on the configured Frontend project found nine playlist entries.
Three used their release slug in the track column. All three had consistent
saved track metadata and matching catalog tracks. The migration repairs only
this verified shape, retains row UUID/order/data, and aborts on unresolved
identity mismatches or resulting duplicate identities. No hosted rows were edited.

## Verification

- 19 focused tests passed: identity, cache ordering/hydration, interrupted saves,
  revision conflicts, ownership, duplicate handling, guarded legacy migration,
  actual playback URL construction, and local HTTP handlers backed by PGlite.
- 48 existing playback regressions passed: listening continuity, section queues,
  completion/stale events, and album cover identity.
- Modified JSX parsed successfully; whitespace checks passed.
- HTTP tests used actual Next response handlers and a local server/database;
  authentication was mocked. PGlite is not a multi-connection concurrency proof.
- No deployed migration, browser interaction, physical-device listening, or
  production playback verification was performed.

## Release requirements

Do not bulk-apply migrations or deploy the unrelated shared working tree.
Review and release only this playlist change after reconciling current source.
The migration removes the old slug-only conflict constraint and direct writes;
therefore the old API cannot keep writing after it is applied. The new API also
requires the migration. Coordinate a playlist-write cutover (or design and test a
separate staged compatibility rollout) before production application. Existing
listening does not need to stop or reload for the database change.

Old clients without a playlist revision receive 409 and must reload saved
playlist state using the new app; they must never silently overwrite newer state.
After activation, verify cross-release duplicates, reorder persistence across
sessions/devices, authorization, and listening continuity using real clients.
