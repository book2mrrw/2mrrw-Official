# GLYPHS Studio: visual authoring and gestures

The previous editor exposed timing through a dense group of text, numeric fields, and capture buttons. Uploads and current-song edits shared the durable contract, but lacked a visual sequence, touch navigation, rehearsal transport and a listener-style preview.

The upgraded shared LyricTimingEditor now owns Write → Time → Preview, keeping the existing controlled value/onChange and recording-bound Enhanced LRC/draft formats. It uses the platform's dark surfaces, existing Outfit/DM Mono fonts, cyan/violet accents and actual uploaded artwork. It adds no metadata schema or audio-access changes.

The Time screen has a sticky transport, actual cue timeline, large selected lyric, active word chips, progress and a cue list. Its capture pad uses a single controller for pointer and keyboard input: a line tap stamps touch-down time once, word hold/release records real start/end times, and horizontal swipes navigate without stamping. Vertical movement, canceled pointers, lost capture/focus, visibility changes, seeking and loop restarts cancel incomplete holds. Text fields and native audio retain their keyboard behavior.

Rehearsal uses two seconds of lead-in and a selected-line loop derived from actual audio time. The slider, keyboard seeks and transport all control the same authenticated reference element. Starting reference playback pauses the main player through the root AudioProvider's existing public pause action on both embedded and direct admin routes; a failed pause stops the reference and reports the problem. It does not clear the listening queue, change purchases/access, or automatically resume background music. Other reference players pause when one starts. The exact selected recording prepares automatically with no Load gate. All three views keep the same media element; returning to Write pauses it, and unmount/parent saving also pauses it. Playback speed stays with this recording.

Preview places lyrics over the actual still artwork or a branded gradient when artwork is absent. LyricTranscript is shared with the consumer player; whole-line illumination is the default even when a document includes word timestamps. Cue markers are actual saved/draft timestamps, not a fabricated waveform. Plain text remains valid and is explained as an optional path. Re-marking a line moves its existing word cues as a group. Clearing all text emits a plain empty string rather than leaving an impossible-to-apply empty timing draft.

Both UploadWizard entry points supply artwork and upload-specific save guidance. InlineReleasesManager supplies the current cover and current-song save guidance; its recording selector retains each recording's edits in the parent lyric map. The studio distinguishes draft/applied state and explains Apply → Save Lyrics or Apply → Review/publish. Changed-reference review, bounded history, imports/exports, atomic persistence, preview restrictions and the previously repaired modal controls remain in place.

The workflow takes inspiration from the [official Musixmatch workflow documented by Spotify](https://support.spotify.com/kz-en/artists/article/managing-your-lyrics-on-spotify/): listen and align a line to its first sung word. The visual system and specific swipe/keyboard controls are 2MRRW's own implementation. No proprietary interface, service integration, automatic alignment or transcription is claimed.

## Verification

- Source/dependency review followed both upload call sites and the existing-song editor through the shared timing format, reference route, draft persistence, publication and public preview renderer.
- `scripts/test-lyric-studio-dom.mjs`: 22 simulated production-component checks cover tap timing/double-click prevention, both swipe directions, vertical/canceled gestures, word hold/repeat, keyboard selection/nudges, native/text shortcut isolation, undo/redo, scrubbing, lead-in/loop, preview continuity/artwork/word sweep, background playback coordination and failures, parent-save disabling, applying and empty-text clearing.
- The existing 13 authoring component checks and 10 PostgreSQL-backed form checks cover imports/exports, reference replacement, offsets, partial/applied full-wizard resume, save/reopen for current/legacy songs, new single/album inputs and first publication. Audio, authorization and pointer events are fixtures.
- Final local results: 240 checks passed (22 studio, 13 authoring, 10 forms, 23 modal and 172 contract checks), and the webpack production build passed. The new studio component and shared status helper have no lint errors or warnings. Focused lint still reports two existing UploadWizard errors at lines 894 and 896 (render-time ref access and Date.now); those lines are unchanged by this work. Existing manager/wizard warnings remain.
- The supported browser connection exposes no browser. Browser screenshots, actual layout/hit testing, physical swipes, codec support and real audio timing accuracy remain unverified. CSS compiles, but that is not visual browser proof.

Expected benefits are a clearer first-use path, fewer simultaneous controls, easier repeated timing passes, and one consistent workspace for current and future releases. No measured usability, engagement or synchronization improvement is claimed.

## Source evidence

- `src/components/admin/lyrics/LyricTimingEditor.js:27`: shared controlled studio; `:63` owns media cleanup; `:118` owns line/word capture; `:151` coordinates reference playback with the existing root player; `:191` scopes keyboard commands; `:206` owns pointer gestures; `:289` renders artwork-backed preview.
- `src/components/admin/lyrics/LyricTimingEditor.module.css:1`: scoped visual and responsive styling.
- `src/components/admin/InlineReleasesManager.js:1249`: existing-release recording selection and shared editor; `src/components/admin/UploadWizard.js:1533` and `:1541`: album and single upload integrations.
- `src/lib/lyrics/timing.js:114`: shared draft/imported/applied status labels. Existing serializers and validation remain the save contract.
- `src/app/layout.js:74` and `src/context/AudioContext.js:207`: the existing root provider and public player hook supply playback coordination across admin entry points.
- `scripts/test-lyric-studio-dom.mjs:1`, `scripts/test-lyric-timing-dom.mjs:1`, and `scripts/test-lyric-forms-dom.mjs:1`: simulated gesture/lifecycle tests and PostgreSQL-backed save/reopen coverage.

The plain-language [quickstart](LYRICS_STUDIO_QUICKSTART.md) describes the controls and final save actions.

## Local follow-up phase: whole lines and recording readiness

The 2026-10-23 local implementation supersedes the earlier word-sweep playback behavior and Load gate. [Phase report and evidence](../../../../docs/reports/phase-lyrics-whole-line/PHASE_REPORT.md) records the exact baseline, source changes, interval contract, touch regressions, existing-song/album saves, automatic preparation, mobile integration boundary and final verification. It is not committed or deployed. The 240-check result above describes the earlier deployed phase, not the current phase.


### Unfinished drafts follow-up (2026-10-24, local only)

Save draft now preserves incomplete words and partial cue documents independently of public Save Lyrics. Uploads reuse the existing wizard queue. Existing releases use account/recording-scoped private drafts with CAS revisions and exact published-baseline checks, plus synchronous device recovery. The additive `20261024010000_private_lyric_working_drafts.sql` is tested locally and has not been applied remotely. This is the only schema addition in the combined local phase; the earlier visual-only phase required none. The Phase report records new save/reopen/refresh tests and rollout requirements.
