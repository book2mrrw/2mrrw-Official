# GLYPHS Studio — whole-line lyrics, automatic recording preparation and durable drafts

**IMPLEMENTED LOCALLY — REGRESSION-VERIFIED, NOT DEPLOYED**

Final handoff: 2026-10-25. Worktree: `lyric-timing`, branch `codex/lyric-timing`. Starting and final HEAD: `56636d21bdc233aabdd20a04e338926c7d532aed`. Changes are uncommitted. No push, deployment, remote migration or production configuration change was performed. This report qualifies implementation by the evidence below; it does not certify browser appearance, physical touch or audible synchronization.

## A. Executive summary

The existing foundation already provided artwork-backed lyrics, authenticated recording references, Write → Time → Preview authoring, line/word capture, rehearsal, undo/redo, Enhanced LRC, upload draft resume, atomic public saves and repaired credits/lyrics modal controls. Those working paths were retained.

Confirmed source defects were a manual recording-load gate, a reference element absent from Write, word illumination overriding the required whole-line presentation, a 50 ms early highlight offset, selection stopping at a missing timestamp, and a touch drag that could return to its origin and accidentally stamp a line. Text edits could also discard neighboring cues because reconciliation relied on row position. Existing published-song Save Lyrics correctly refused incomplete timing, but provided no separate private working-copy save.

The shared editor now prepares the exact selected recording automatically, retains one reference element across tabs, and exposes Save draft for unfinished text and partial timing. A shared transcript presents whole illuminated lines in both listener and editor preview. Existing releases get account/recording-scoped device recovery and a private server draft contract. New uploads reuse their existing draft owner and queue. Server draft storage for existing releases requires the additive local migration before rollout; it has not been enabled remotely.

Available evidence: 332 focused feature checks passed, 320 broader playback/core checks passed, and the production webpack build passed. The auth suite has the same two failures as untouched HEAD; focused lint has the same two pre-existing UploadWizard errors. Browser/device evidence is unavailable. The current Capacitor app lacks a usable playback interface, so native lyrics integration was not fabricated.

## B. Foundation inventory

- [Timing, formats and playback identity](../../../apps/web/src/lib/lyrics/timing.js): seconds, plain text, Enhanced LRC, unfinished JSON documents, reference fingerprints and `lyricClock`. [Legacy LRC API](../../../apps/web/src/lib/lrc.js) remains supported.
- [Listener panel](../../../apps/web/src/components/preview/GlyphLyricsPanel.js:104) sits inside the existing [single/album immersive modals](../../../apps/web/src/components/preview/ImmersivePreviewModal.js:1129). The modal consumes the existing player hook and passes its authoritative position through `lyricClock`; the transcript has no media engine or playback subscription.
- [Shared editor](../../../apps/web/src/components/admin/lyrics/LyricTimingEditor.js:28) owns one authenticated native reference element. It consumes actual `currentTime`, metadata, seeking and buffering events. Existing reference playback coordination pauses the root player only on explicit reference playback.
- [Existing-release editor](../../../apps/web/src/components/admin/InlineReleasesManager.js:498) owns per-recording controlled lyric values and public save baselines. [UploadWizard](../../../apps/web/src/components/admin/UploadWizard.js:1305) owns new-release state, the existing autosave queue, session recovery and server `release_drafts` resume.
- Public saving still uses `commitLyricEdit`, existing authorization and existing database publication functions. Private work uses [working-draft controller](../../../apps/web/src/lib/lyrics/working-draft.js:9), [React lifecycle adapter](../../../apps/web/src/components/admin/lyrics/useLyricWorkingDraft.js:5), [server adapter](../../../apps/web/src/lib/lyrics/draft-store.js:11) and the existing admin release GET/PATCH route.
- Current mobile app: the sibling `tomorrow-mobile` repository, branch `feature/mobile-foundation`, baseline HEAD `a36e08adab2a7f917db6915bb9a080f6a0a1486d`. Its Capacitor config uses `dist`; App renders account/catalog/release UI. Source authorization helpers are not an audio engine. `docs/audio-testing.md` explicitly records the missing engine/UI. Legacy Expo `apps/mobile` is a different application and was not treated as the current app.

Baseline inventories are in [web-before.json](evidence/web-before.json), [worktrees-before.txt](evidence/worktrees-before.txt) and [capacitor-before.json](evidence/capacitor-before.json). No unrelated checkout was cleaned or reset.

## C. Implementation details and architectural correction

1. **Shared timing boundary:** [timing.js:19](../../../apps/web/src/lib/lyrics/timing.js:19) removes anticipation and selects by the real position even when source rows have missing or unsorted legacy cues. `lyricInterval` supplies the same strictly later boundary to rehearsal. `reconcileLyricLines` retains unchanged neighboring cue objects after insertion/deletion/splitting/merging; changed lines require review and retiming. Publication validation remains strict.
2. **Shared presentation owner:** [LyricTranscript.js:22](../../../apps/web/src/components/lyrics/LyricTranscript.js:22) and its CSS replace listener word sweeps and editor-specific preview rendering. Memoized line nodes, boundary-driven positioning, manual follow suspension and explicit return-to-current behavior are shared. Resize/visibility recovery only positions text; it never starts media.
3. **Recording workspace ownership:** [LyricTimingEditor.js:28](../../../apps/web/src/components/admin/lyrics/LyricTimingEditor.js:28) keys state to editor account/release/recording. Its effect at line 121 automatically requests the exact reference, aborts superseded requests and ignores late responses. One media element remains mounted across all three views. Play waits for actual metadata. Failed/missing references explain recovery without losing text.
4. **Gesture correction:** [editor pointer controller](../../../apps/web/src/components/admin/lyrics/LyricTimingEditor.js:229) remembers movement beyond the threshold, including an out-and-back gesture. Swiping/navigation and cancellation cannot stamp a line. Secondary touches cannot replace the primary pointer. Seeking, buffering, lost capture and focus loss cancel incomplete holds. Visible controls remain sufficient without gestures.
5. **Listener integration:** single/album panels pass recording identity to reset presentation state. Full-playback line seeking reuses the established seek command. Preview-only restrictions and `lyricClock` identity matching remain in force. No player initialization, queue or engine code was replaced.
6. **Private draft owner:** [working-draft.js:9](../../../apps/web/src/lib/lyrics/working-draft.js:9) synchronously stores edits on the device before parent state updates, serializes server writes through the existing save queue, and compares UUID revisions plus exact published baselines. Late hydration cannot silently replace already typed work. Refresh/lost-ack races accept identical durable content; different content requires a visible choice. Generic success without a revision never produces a server-saved claim.
7. **Both save paths:** [InlineReleasesManager.js:1280](../../../apps/web/src/components/admin/InlineReleasesManager.js:1280) supplies account identity, saved baseline and durability feedback. Parent state is account-scoped. Navigation warns when the current edit has neither a device copy nor a server acknowledgement. [UploadWizard.js:2087](../../../apps/web/src/components/admin/UploadWizard.js:2087) passes its existing flush/state owner to both single and album editors; it does not create a competing upload draft store.
8. **Private server boundary:** [existing release route:38](../../../apps/web/src/app/api/admin/releases/[id]/route.js:38) and [line 91](../../../apps/web/src/app/api/admin/releases/[id]/route.js:91) retain session-admin and rate-limit checks. Expected editor account must match the actual session actor. Private saving does not publish or revalidate storefront content. The server derives the authoritative actor from the session.

The code changes repair shared timing, presentation, workspace and persistence ownership rather than adding independent caller-specific rules. Public lyric formats, media authorization and publication remain the existing contracts.

## D. Visual behavior

**Whole-line illumination is the default, including documents with word timestamps.** The complete active line is white with a restrained cyan glow over the artwork scrim; previous lines are subdued `#9296a5`, upcoming lines `#b8bbc6`, and untimed plain lyrics remain white. Word metadata is preserved for editing, never converted into default listener word illumination.

The existing dark surfaces, Outfit/DM Mono typography, artwork, cyan/violet accents, modal controls and fullscreen/share behavior are retained. Responsive typography, wrapping, 44 px line/control targets, safe-area padding, visible keyboard focus and reduced-motion rules are implemented. Follow moves only when the active boundary changes and the line is outside a comfortable viewport region. Touch, wheel, navigation keys or manual scrolling suspend follow; **Back to current lyric** restores it without seek or autoplay.

Simulated DOM checks verify states, text, compiled CSS rules, commands and geometry-dependent decisions. No desktop/mobile screenshots, real hit-testing, OLED assessment or physical-device visual approval was possible. The implementation is styled and built; its appearance has not been verified in a connected browser.

## E. Deterministic timing contract

- Positions are finite nonnegative **seconds on the full recording timeline**. Enhanced LRC encodes fractional milliseconds with rounding. Missing starts are `null`, never guessed.
- A line starts inclusively at its timestamp. The next strictly later start is its exclusive end. There is no artificial lead/lag offset.
- Active selection finds the greatest timestamp not after the real position. For equal timestamps, the last source row wins. Text order is preserved; legacy unsorted data can display deterministically, but invalid/out-of-order edits cannot be applied.
- A missing timestamp does not stop later valid rows from being selected. Untimed rows remain visible.
- Whole-line emphasis lasts until the next actual line start, including held notes and inter-phrase silence. Blank sections add visual spacing; they are not inferred vocal durations.
- Explicit **word** ends remain editing detail and never shorten a whole line. No new line-end field or guessed duration was introduced. Rehearsal uses the same next-start rule.
- A known positive recording duration is the exclusive final boundary. Without a known duration, the last valid line holds while an authoritative matching position remains available. Unavailable/invalid position clears synchronization rather than extrapolating.
- Existing `lyricClock` checks recording/release identity and applies an established preview offset only when the source identity and preview contract support it. An unrelated recording cannot provide the clock or permit lyric seeking.
- Pauses, stalls, playback-rate changes and forward/backward seeks use actual media position; no independent elapsed-time clock advances lyrics. Track changes/unmount reset presentation and remove layout listeners. Visibility/rotation/resize recovery uses the current supplied position and repositions the view only.

These are deterministic source/fixture results, not measured audible timing accuracy across devices.

## F. Artist workflow

1. Open **Lyrics** for an existing release, or reach **Artwork & Lyrics** after uploading audio. Select the intended album recording. Its uploaded audio prepares automatically; there is no Load step.
2. Enter/paste lines in **Write**. Blank rows and repeated sections are retained. Import/export remains supported.
3. Press **Save draft** whenever needed, including incomplete words or partial cues. Current-release edits get immediate browser recovery and server sync after a pause when the private store is available. **Draft saved** means acknowledged server durability. **Saved on this device** means browser recovery with server sync pending/unavailable. Uploads use the wizard’s existing draft queue/resume.
4. Press Play, then tap **Sync this line** or Space at the first sung word. It records the real clock and advances selection. Word mode explicitly uses hold/release. Swipe left/right navigates without stamping; visible selection controls also work.
5. Correct the selected cue, nudge by 50 ms, re-record it, undo/redo, or rehearse with lead-in/loop. Bulk offsets remain explicit. Unchanged neighboring rows retain cues when text layout changes.
6. Review the artwork-backed whole-line **Preview**. Missing/out-of-order cues and changed audio reference require review. **Discard lyric edits** asks inline confirmation, restores the saved/opened baseline and remains undoable.
7. **Apply timings** validates the document. Finish with **Save Lyrics** for an existing song, or Review/publish/schedule for an upload. Saving a draft never publishes it, and applying timing is not a server save.

See the [plain-language quickstart](../../../apps/web/docs/credits/LYRICS_STUDIO_QUICKSTART.md) and updated [feature/gesture ledger](../../../apps/web/docs/credits/LYRICS_STUDIO_VISUAL_AND_GESTURES.md). Storage failures and version conflicts remain visible; leaving is guarded when no durable current copy exists. Device recovery is browser/account/recording-specific and is not a promise of cross-device availability.

## G. Web/mobile compatibility matrix

Each entry states implementation, position owner and proof separately:

- **Web listener, single/album modals:** implemented. Existing player → identity-checked `lyricClock` → shared transcript. Controlled props provide position; transcript mounts/cleans presentation listeners only. Focused modal/DOM and playback regressions pass. Authenticated browser playback and visual proof remain unavailable.
- **Web artist, existing canonical/legacy single/album:** implemented. Selected authenticated reference element owns actual clock. Private working copies restore independently of public lyrics; public saves retain existing atomic contracts. Fixture media/auth plus local PostgreSQL tests pass. Server-draft migration is local only.
- **Web artist, future uploads:** implemented. Earlier uploaded recording identity/reference plus existing wizard draft queue. Single/album, partial draft resume and publication fixtures pass. Original media format support is still the browser’s native capability.
- **Responsive web/mobile browser:** safe areas, touch targets, pointer/keyboard paths and reduced-motion CSS are implemented; simulated tests and build pass. Physical touch, screen rotation/fold behavior, browser scrolling and codec support are unverified.
- **Current Capacitor app:** no lyric/player integration claimed. Catalog normalization does not expose a usable lyrics-plus-playback-position contract. Authorization helpers do not expose a live engine position, occurrence identity, playback lifecycle or scoped seek. Its 149 baseline files are unchanged; baseline typecheck and 54 tests pass. No native build or device test was performed.
- **Legacy Expo/TrackPlayer app:** excluded from current-app claims; untouched.

Minimum safe native prerequisite: an existing-player adapter exposing nullable authoritative position, exact recording/occurrence identity, playback state, permitted seek, subscription/unsubscription and foreground/background lifecycle. Building that player is outside the authorized lyrics-only scope. This documented boundary is the task’s permitted fallback, not a successful native integration.

## H. Test report

Full commands and results are in [test-results.json](evidence/test-results.json); raw logs are alongside it.

**Baseline before product edits:** 250 focused checks passed: 172 contracts, 22 studio, 13 authoring, 10 forms, 23 modals and 10 local PostgreSQL workflow checks. The existing UploadWizard lint errors were recorded. The current mobile baseline typecheck and 54 tests passed.

**Failed-before requirement reproductions:** [interval regressions](evidence/before-new-interval-regressions.log) initially had 8 failures/2 passes for boundary/missing/legacy/reconciliation behavior. [Recording readiness](evidence/before-recording-readiness.log) observed zero automatic requests where one was required. [Whole-line reproduction](evidence/before-whole-line-dom.log) exercised the committed original panel and failed because it rendered word illumination. These are source/component fixtures, not real audio/browser reproductions.

**Final focused checks: 332 passed.** 209 Node contract checks; 22 studio DOM; 13 authoring DOM; 17 PostgreSQL-backed form; 23 modal DOM; 10 PostgreSQL publication workflow; 11 automatic recording/gesture; 15 whole-line presentation; 12 private-draft PostgreSQL checks. The 209 already include new timing, draft-controller and API tests; separate diagnostic logs are not counted again.

Coverage includes exact boundaries, held/final phrases, gaps, duplicates, missing/unsorted cues, null clocks, seek/identity changes, preserved text ordering, undo/redo, selected second album track, canceled/out-and-back/multitouch gestures, stale reference responses, retry, tab continuity, device refresh recovery, partial Save draft/reopen, server failures/quota, old acknowledgement races, conflicting versions, Strict Mode lifecycle, no writes on merely opening, private actor isolation and removed/deleted/foreign recording denial. Repeated samples within the same line caused zero DOM mutations in the simulated transcript test; that is not a browser performance measurement.

**Broader checks:** listening continuity 164/164 and core invariants 156/156 passed. Auth security: 254 passed, 2 failed, exactly matching a source snapshot of unchanged HEAD. Existing failures are `INV-MFA-4` and `F0-ADMIN-1`, which identify four existing broadcast routes absent from classification/authority inventories. No new route was introduced and those unrelated files were not modified. Baseline reconstruction and comparison are saved in [auth-baseline-snapshot.json](evidence/auth-baseline-snapshot.json), [baseline-auth-security.log](evidence/baseline-auth-security.log) and [after-auth-security.log](evidence/after-auth-security.log).

**Lint:** all new product modules and the changed timing/listener/editor/API modules have zero errors/warnings. Existing UploadWizard errors remain at lines 894/896 (render-time ref access and impure Date.now). Existing manager/wizard/modal warnings remain. This is not a clean full lint claim; see [baseline-lint.json](evidence/baseline-lint.json), [baseline-modal-lint.json](evidence/baseline-modal-lint.json) and [after-lint.json](evidence/after-lint.json).

**Build/runtime:** `next build --webpack` passed, including its typecheck/static-generation stages. Local final production build served `/admin/upload` with HTTP 200. Anonymous reference metadata GET, private draft GET and private draft PATCH all returned 401 before protected work. [Runtime HTTP evidence](evidence/local-runtime-http.json) proves local delivery/auth gates only. The local server was stopped after checks.

No assertions were deleted to obtain green results. Word-sweep expectations were replaced by the requested whole-line behavior. Motion fixtures were corrected to retain stable component types, avoiding artificial remounts. Real schema constraints and production form/handler paths remain exercised. Fixture authentication/audio/geometry do not prove hosted authorization, audible playback, browser layout or native gestures.

## I. Data and migration assessment

Whole-line timing uses existing lyric text/draft formats and derived next-start intervals; it needs no schema change. The later explicit unfinished-save requirement exposes a genuine separate storage need: public Save Lyrics rejects incomplete documents by design, existing `release_drafts` only serves draft releases, and its canonical FK cannot represent legacy catalog products. Reusing either would mix private incomplete authoring with public data or violate existing ownership contracts.

One additive migration was created: [20261024010000_private_lyric_working_drafts.sql](../../../apps/web/supabase/migrations/20261024010000_private_lyric_working_drafts.sql:1). It creates an account/release/recording-keyed private table and service-only read/save RPCs. Exact canonical/legacy membership, published baseline comparison, UUID CAS revision, advisory serialization of initial inserts and parent/recording locks protect writes. Removed/deleted/obsolete/foreign identities are rejected. Partial documents are stored as text without publishing them.

Local captured-schema PGlite tests applied and exercised this migration, including anon/authenticated privilege denial. History now contains 126 migration files, with no duplicate version identifiers; existing migration versions were not changed. [Migration evidence](evidence/migration-history.json) records the result.

**No remote application occurred.** A later rollout must apply/review this additive migration before enabling the deployed private server path, then verify real admin draft save/readback and public isolation. Until that path is available, the UI reports device-only recovery. Rolling application code back leaves an unused private table; no public lyric backfill or destructive rewrite is needed. No paid dependency, third-party lyrics API or new package was added.

## J. Security and regression assessment

Private endpoints remain inside existing session-admin/rate boundaries. Actor IDs come from the authenticated server session; client expected-account values only detect account switching. Responses are private/no-store. SQL RPC/table privileges are denied to anon/authenticated roles; service-role calls are constrained by route authorization and membership validation. Private saves neither update public lyrics nor invalidate the storefront.

Device cache keys include author/release/recording. State remounts on account changes so a previous editor’s recovered lyrics do not survive into another account workspace. Device storage is a local recovery copy, not an authorization source. Published revision checks, audio fingerprint review, preview restrictions and exact selected recording behavior are preserved. Storage content is rendered as text, not HTML.

Playback isolation remains the original engine and public transport; lyrics do not establish a competing listener clock, engine or queue. Existing native reference playback is retained for artist authoring, with the original main-player coordination. Credits/lyrics modal regressions, entitlement-related media contracts, catalog persistence and broader player suites were checked. No 2MRRWBase, purchases/subscriptions/entitlements, native app, production settings, dependency manifests, Phase 9 ownership report or existing migration ledger was modified.

## K. Known limitations

- Supported browser discovery returned **No browser is available** and an empty browser list. No alternate browser automation was substituted. Signed-in interaction, screenshots, physical gestures, codecs, audible synchronization, screen rotation/fold behavior and actual background/foreground playback remain unverified.
- Existing-release server drafts cannot work in an environment until the local migration and code are rolled out. Device recovery is explicitly labelled meanwhile. Browser clearing, a different browser/device or unavailable local storage cannot preserve a device-only copy; the UI exposes failure and retains exit guards when server acknowledgement is absent too.
- Current Capacitor lacks the playback contract described in G. No native compatibility claim is made.
- The model has line starts and optional word ends, not independently authored line ends/silence intervals. Next-start/final-duration rules intentionally hold the phrase through gaps rather than guess vocal duration.
- The two baseline lint errors and two baseline auth-inventory failures remain. Source/fixture/build checks do not certify production security or universal device behavior.

## L. Final diff and integrity evidence

Review [web-after.json](evidence/web-after.json), [final-source-diff.patch](evidence/final-source-diff.patch) and [final-files.sha256.json](evidence/final-files.sha256.json). They enumerate tracked changes plus new lyrics modules/tests/migration and hashes of the final implementation/report. Logs/manifests are excluded from the source patch and self-hash set.

Changed areas are limited to the shared timing/LRC helpers, shared transcript/CSS, listener/modals, shared editor/CSS/hook, current/new upload integrations, private-draft route/adapter/controller/migration, focused tests/fixtures and lyrics documentation/evidence. The original source checkout remains untouched. Current Capacitor baseline file hashes are compared in [capacitor-after.json](evidence/capacitor-after.json); no baseline file changes were found. Final whitespace checks passed with CRLF-aware Git settings. HEAD is unchanged and the index is empty.

**Practical benefit supported by fixtures:** the intended recording is automatically available, whole-line emphasis follows deterministic actual-position boundaries, canceled gestures do not create cues, and partial text/timing survives save/reopen and simulated refresh without publishing. Expected benefit is a clearer workflow and less repeated typing/timing work. No usability, latency, audible accuracy or engagement improvement was measured.
