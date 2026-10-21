# Modal Credits and Lyrics buttons — 2026-10-21

## Findings and evidence

The single and album modals already had click handlers, but connected data and interaction contracts were incomplete:

- Catalog track selection/mapping omitted saved lyrics. The fresh attribution response therefore could not deliver lyrics from canonical recording rows. The modals read older caller data instead. Source findings and mocked catalog regressions confirm this path.
- The shared parser discarded all ordinary text without LRC timestamps. Running the committed previous parser reproduced an empty result for plain lyrics. It also parsed `[00:01.5]` as 1.05 seconds; the corrected parser yields 1.5 seconds.
- Artwork pointer handling did not distinguish buttons from artwork. In slow-locked mode it immediately captured the pointer on the artwork parent. Simulated DOM tests exercise the actual hook: controls now avoid capture while artwork itself still captures normally.
- Persistent modal state retained open lyric panels across close/reopen. Credits had only an unnamed four-pixel dismissal handle. Fullscreen lyrics remained inside the modal's transformed, overflow-hidden container; fixed descendants are constrained by that containing block. Browser geometry has not been measured in this session.

## Architectural changes and files

- [Catalog projection](../../src/lib/media/catalog-db.js#L271) now selects and retains recording lyrics, including the fresh response. Explicit empty lyrics are preserved, source/catalog recording identities stay associated, and visibility/authentication gates are retained.
- [Scoped editorial selection](../../src/components/preview/releaseMetadata.js#L23) resolves source UUID, catalog UUID or recording slug without using another recording's lyrics.
- [LRC parser](../../src/lib/lrc.js#L7) supports ordinary text with no invented timestamps and preserves timed LRC ordering/repeats with correct decimal precision. Plain lines never become timed seek targets.
- [Artwork gesture owner](../../src/hooks/useArtworkGesture.js#L110) yields interactive descendants and the lyric panel to their own handlers.
- [Single and album modals](../../src/components/preview/ImmersivePreviewModal.js#L1108) consume fresh scoped lyrics, expose expanded state, support Escape, and reset editorial panels when closing/reopening or switching releases. Album lyric selection follows its selected recording; credit scope remains independent of playback.
- [Credits sheet](../../src/components/preview/CreditsSheet.js#L2) has a named native Close button and a labeled region.
- [Lyrics panel](../../src/components/preview/GlyphLyricsPanel.js#L104) distinguishes loading/error/retry/empty, renders untimed text readably, derives its timed highlight from current input, and portals fullscreen content into the document body to escape modal clipping. Existing preview seek restrictions remain in place.

No migration or production content edit is required. Existing admin lyric saves already signal catalog invalidation, which the shared fresh-read hook observes.

## Verification

1. Source/dependency tracing covered both exported modal entry points, saved source/catalog lyric ownership, the current admin lyric save/invalidation path, shared parser, artwork capture and fullscreen containing blocks.
2. 146 Node regressions passed across credits, catalog, upload/publication and modal lifecycle/bridge paths. New cases include source lyrics, catalog/source identity, explicit clears, plain lyrics, LRC timing, metadata-only empty states and scoped selection. Thirteen simulated DOM checks mount the actual production modals, sheets, lyric panel, request hook and artwork hook, with fixture fetch/auth/media dependencies. They exercise opening, closing, Escape, persistent reopen, credit scope, actual portal mounting, stale/empty recording separation, pending/error/retry states, and absence of playback commands while using editorial controls. These are not browser hit-testing or media-playback tests.
3. Production webpack build passed. Focused changed-module lint completed with zero errors or warnings. Hosting completion and exact commit/deployment identity are reported in the completion message.

The connected Browser runtime was initialized and its documented discovery/recovery path returned no available browsers. No standalone browser bypass was used. Signed-in production click behavior, viewport geometry, native touch and physical devices remain unverified. A connected signed-in browser is required for that remaining check.

Expected practical benefit: both buttons expose the correct saved recording content with clear dismissal and recovery, while editorial interaction avoids changing playback or triggering artwork gestures. No performance metric or universal device coverage is claimed.

## Repeat the simulated DOM check

From `apps/web`, install test dependencies into a temporary directory, then run:

```sh
npm install --prefix /private/tmp/modal-verification --no-audit --no-fund --ignore-scripts jsdom esbuild
MODAL_JSDOM_MODULE=/private/tmp/modal-verification/node_modules/jsdom/lib/api.js MODAL_ESBUILD_MODULE=/private/tmp/modal-verification/node_modules/esbuild/lib/main.js node scripts/test-modal-editorial-dom.mjs
```

This does not modify application dependency manifests or connect to production. The fixture explicitly stubs media/auth boundaries and animation; it does not simulate browser layout.
