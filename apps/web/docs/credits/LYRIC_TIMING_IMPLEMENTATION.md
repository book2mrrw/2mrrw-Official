# Lyric timing in Upload Manager

Implemented 2026-10-22. This is a manual line/word synchronization workflow, using the platform's own recording and playback contracts. It does not claim full Musixmatch product parity, automatic transcription/alignment, or an external Musixmatch integration.

## Findings and shared solution

The previous upload and existing-release lyric fields accepted text, while the listener parsed basic line LRC. There was no shared timing author, word start/end contract, durable partial timing workflow, or verification that cues belonged to the current master. Legacy singles without track rows also lacked a recording row to edit.

Both UploadWizard's Artwork & Lyrics step and InlineReleasesManager's Lyrics tab now use the same LyricTimingEditor. New single uploads use the durable uploaded track_id; albums use each recording's track_id/id. Existing release loading resolves product aliases to canonical releases and exposes lyric_recordings, including a virtual lyric owner for legacy single products. It does not fabricate a track in audio/deletion/credits workflows.

The editor supports text, line capture at the first sung word, independent word start/end capture, scrubbing, playback speed, numeric cue editing, global offsets, bounded undo/redo, Enhanced LRC import/export, and explicit Apply timings. Both editor and listener use TimedLyricWords for the cue sweep. Full audio is streamed through a session-gated admin endpoint; storage keys and presigned URLs are not returned to the browser. Every audio/range request verifies membership and the current opaque recording fingerprint. The upstream request is conditional on the verified ETag.

## Current songs and future releases

- **Existing song:** Upload Manager → open release → Lyrics → Synchronize → Load recording reference. Capture or edit cues, Apply timings, then Save Lyrics. Reopening restores the applied document. Concurrent edits return a conflict without an independent partial write.
- **Future release:** upload its audio, then Artwork & Lyrics → Synchronize for the single or selected album track. Partial edits enter the existing draft autosave payload; Apply timings before publishing. The publication handler verifies the input before storage copies, preserves explicit empty lyrics, and rebinds the opaque fingerprint after its own verified source copy.
- **Master replacement:** a changed reference requires explicit review in the author. Fresh public editorial responses show plain text if the saved fingerprint is stale or unavailable. Existing loaded client snapshots are not a continuously polled revocation mechanism.

## Durable contract and migration

The existing lyrics text storage remains the shared payload: plain text and old line LRC remain supported. Applied documents contain `[2mrrw:1,<sha256 recording identity/etag/length>,<duration>]`, line `[mm:ss.xxx]` cues and optional word `<start>text<end>` cues. Explicit word end times preserve gaps; no equal-duration or wall-clock estimate is invented. Blank stanza boundaries remain available when removing timing. Unfinished drafts use a separately recognized draft envelope; saves and publication reject them until applied or converted to text.

Validation rejects missing, negative, nonfinite, unordered, overlapping, mismatched-word and out-of-duration cues. A known preview start offset converts the preview clip clock to the full recording timeline. Unknown offsets and a different playing recording yield no highlight. Existing entitlement and preview seek restrictions remain authoritative.

`supabase/migrations/20261022010000_atomic_lyric_timing_edits.sql` adds only `commit_release_lyric_edit(uuid,jsonb,jsonb)`. It locks the release/product/recordings, checks the existing revision contract, validates all target membership, and projects source plus catalog in one transaction through existing projection helpers. Legacy singles use product.metadata.lyrics. No columns, backfill, credit allocation rules, access grants or existing RPC definitions change. The function is SECURITY DEFINER with a fixed search path, callable only by service_role. Server handlers enforce administrator authentication and cue/master verification before invoking it.

Applied to Supabase project qvfbgkbgczyqrglvgyqr with the authenticated CLI. The function and one migration history row were committed together. Preflight confirmed both prerequisite credit migrations and absence of the new function. Live verification saved a probe, checked source/projection and returned revision, rejected a stale revision and a later foreign target, then explicitly rolled back all content edits. Counts remained releases 13, products 29, tracks 8, catalog_tracks 30. Execute grants: anon false, authenticated false, service_role true.

Rollback: revert the application commit while retaining this additive function and stored text. Do not delete cue data or revert unrelated credit migrations. A database downgrade is unnecessary for application rollback.

## Verification and limits

- Source trace: upload completion identity → wizard state → draft snapshot → publication → source/catalog → editorial API → matching playback clock → modal. Existing editor uses the same author and atomic persistence boundary.
- 158 unit/contract regressions pass across timing, audio ownership, reference route authorization/range handling, credits, publication and upload hardening. Eight additional catalog/cache/HLS source regressions pass.
- 11 simulated authoring DOM checks pass, including line/word capture, invalid cue rejection, reference replacement review, undo/redo, offsets and import/export.
- 20 simulated modal DOM checks pass, including existing editorial controls, supplied-clock word sweep, manual scroll/follow resume and backwards seeking.
- Seven PostgreSQL-backed form checks use the actual shared upload step, existing editor, publication handler and SQL. They cover current canonical and legacy songs, future single/album authoring, draft storage, first publication/reopen and unfinished/stale timing rejection before storage copies. Authentication, storage and audio positions are fixtures.
- Ten timing PostgreSQL checks and 19 existing credits/publication PostgreSQL checks pass on captured-schema PGlite. They cover revisions, batch rollback, source/catalog projection, legacy identity, draft state and role permissions.
- Production webpack build passes. New timing code lint passes. Whole touched-file lint retains two preexisting UploadWizard errors (render-time ref access and Date.now), reproduced against unchanged main; it is not a clean whole-repository lint claim.
- Built local runtime returns 401 for unauthenticated reference metadata and logs ADMIN_AUTH_NO_SESSION. Live SQL verification above is separate from local fixtures.
- Connected browser was unavailable in this session. Actual signed-in upload interactions, real audio synchronization accuracy, browser codec support, native touch and physical-device playback remain unverified. The admin reference uses the existing full master, so a browser that cannot decode its format must use a compatible browser/source format. Human timing quality is not automatically measured.

Expected benefit: creators can author once during upload and revise the same cues later; listeners receive matching line/word highlighting above the artwork, while stale or unknown timelines fall back to readable text. These are implementation outcomes and tested contracts, not measured engagement or latency claims.

## Research reference

[Spotify's official Musixmatch workflow](https://support.spotify.com/cg-en/artists/article/managing-your-lyrics-on-spotify/) describes entering lyrics and adjusting timestamps while listening, with each line aligned to its first sung word. [Musixmatch's own Pro app listing](https://apps.apple.com/gb/app/musixmatch-pro/id1588257741) describes line and word synchronization. Those informed the workflow; no proprietary implementation or third-party lyric content was copied.

## Follow-up review, 2026-10-22

The review of commit `4d993391` found five concrete gaps. The follow-up corrects them at shared boundaries:

1. **Reference audio lifecycle:** the editor cleanup depended on reference identity, so changing from Synchronize to Text did not call pause on the detached audio. Cleanup now follows workspace visibility as well as identity, cancels held word captures, and retains the selected playback speed when the audio element remounts. Focus/capture loss also cancels a partial word hold. A simulated component regression failed before and passes after.
2. **Lyric seek identity and preview authority:** the clock correctly returned null for another playing recording, but the lyric lines still exposed the global seek callback. GlyphLyricsPanel now requires a finite matching recording clock for click/keyboard seeking. The album caller also respects the engine's previewOnly flag when the modal's access snapshot says full. Regression checks cover another playing song, preview playback, and a matching full recording; ordinary editorial actions still send no playback commands.
3. **Publication readiness:** Final Review did not run the lyric validator, so unfinished timing looked publishable until the server rejected it. It now uses the same validateLyricText contract as the server for singles and ready album tracks. Valid applied timing and ordinary text remain allowed.
4. **Disabled button semantics:** the upload wizard's shared button removed its onClick handler and changed opacity without setting the native disabled attribute. It now supplies native disabled and type=button, making every existing wizard blocker visible to keyboard/accessibility behavior as well as mouse interaction. The actual Final Review component is exercised for single and album readiness.
5. **Duration ownership after replacement:** source analysis and a failing regression showed that the older track duration could reject cues on a longer promoted master. The resolver now uses duration only from an active revision bound to the exact entity, object key and committed HLS prefix. Unbound historical duration is advisory and is not used to reject cues. Without a verified server duration, Apply waits for the exact reference audio's native metadata and validates the saved document's duration and cues. Tests cover canonical tracks, legacy products and catalog recordings, foreign/inactive revisions, missing manifests, copied masters, optional-table absence and real database failures.

A read-only live CLI check confirmed `hls_manifests` and its duration/prefix columns exist, while `audio_master_revisions` is absent in frontend project qvfbgkbgczyqrglvgyqr. The duration resolver explicitly supports that schema state; it does not activate the separate master-replacement pipeline. Only the documented missing-table errors permit native-duration fallback; other database failures stop source verification. Error-code handling was checked against the [official PostgREST error reference](https://docs.postgrest.org/en/stable/references/errors.html).

Expanded verification: 172 unit/contract checks, 13 authoring DOM checks, 23 modal DOM checks, 10 PostgreSQL-backed form checks, 10 timing SQL checks and 19 existing credit/publication SQL checks pass. The full UploadWizard now mounts against actual draft snapshots for both unfinished and applied timing, then unmounts and verifies the flushed snapshot. Authorization, storage and audio positions in these component tests remain fixtures. The fixture adds minimal existing revision/manifest read columns explicitly; it does not simulate master promotion. The production build passes; focused new-code lint is clean, with the same two preexisting UploadWizard lint errors retained.

The browser connection was retried and exposed no browsers. Authenticated UI/audio, native codec support, touch hit testing and physical-device synchronization therefore remain open verification items. A direct live application-source probe also lacked local admin credentials; the live database evidence here is the authenticated CLI schema read, not a successful service-role media probe. No additional migration or content change was required for this follow-up.
