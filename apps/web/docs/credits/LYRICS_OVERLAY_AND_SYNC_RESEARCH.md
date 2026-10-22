# Lyric overlay, modal hit areas and Musixmatch research — 2026-10-22

## What was wrong

The user reports that Credits and Lyrics still do not activate on real modals. The preceding regression tests called DOM button handlers directly; they did not perform browser hit-testing. Source inspection found that both editorial rows were independently absolutely positioned 108px from the artwork bottom at z-index 10, while the playback panel was painted later at the same z-index. Its waveform, scrubber, 60px play controls, margins and padding extend through that area. This establishes a concrete overlapping hit-area mechanism; a connected browser was unavailable for a measured rectangle or physical-device reproduction.

The lyric layer also left the top of the artwork mostly visible, used small text and made upcoming timed lines very faint. The requested hierarchy is lyrics first, artwork behind them, with the default panel contained inside the artwork.

## Architectural repair and exact owners

- [EditorialActions and FloatingPlayer](../../src/components/preview/ImmersivePreviewModal.js#L611) now own a single bottom control stack for both single and album modals. The title/preview label, editorial row and playback block are normal-flow siblings. There is no independently positioned editorial row for a later playback rectangle to cover. Shared buttons have 44px minimum height; the bounded stack scrolls if artwork height is short. The entire stack is excluded from artwork gesture recognition. Existing playback callbacks, seek restrictions and the newer production HLS work are preserved.
- [GlyphLyricsPanel](../../src/components/preview/GlyphLyricsPanel.js#L151) retains its absolute position within artwork by default, darkens and blurs the background, and renders larger bold white lyrics. The active timed line is white, upcoming lines remain readable, and completed lines recede. Constant font size avoids changing line geometry on each timed highlight. Fullscreen remains an explicit optional mode.
- [Simulated DOM regressions](../../scripts/test-modal-editorial-dom.mjs) now assert both shared layout owners and normal-flow sibling relationships, bounded overflow and button target sizes, rather than relying only on programmatic clicks. They also assert lyric containment/visual styles and timed activation from a fixture playback clock.

Expected benefit: taps reach the editorial row rather than an overlapping playback layer, and lyrics take visual priority while artwork remains in the background. No measured contrast ratio, production touch result, or universal viewport coverage is claimed.

## Research: verified behavior

The product is **Musixmatch**. Its own Pro app listing describes plain lyric entry, synchronization at line and word level, and optional AI or curator assistance. This supports the feature model; it does not expose its internal timing algorithm or exact interface CSS. [Musixmatch Pro developer listing](https://apps.apple.com/gb/app/musixmatch-pro/id1588257741).

Spotify's official description of its Musixmatch workflow says artists can supply audio, listen to lines, adjust each timestamp, and submit. Its timing guidance places a line at the first sung word and prioritizes the main vocal in overlapping voices. [Spotify artist support](https://support.spotify.com/cg-en/artists/article/managing-your-lyrics-on-spotify/).

These sources support using real audio-aligned cue data rather than estimating timing from lyric length. Our stronger scrim, type sizes and layout choices are 2MRRW design decisions based on the user's request, not claims about Musixmatch's proprietary styling.

## Concrete next timing workflow — proposed, not implemented here

The current player already parses timestamped LRC lines and reads playback progress. Existing admin editing saves raw lyric text; it does not yet offer a tap-to-sync authoring UI.

1. Open the exact recording/master in the admin Lyrics tab and enter all lyric lines, including repeats.
2. Play or scrub that recording. Tap a line or use a capture control when its first word starts; store that audio position as the line cue.
3. Allow replay, undo and precise earlier/later adjustment before publishing. Save through the existing revision-checked recording edit transaction. A line-level LRC export can use the existing text field without inventing a parallel persistence path.
4. Verify recording identity, nonnegative/ordered cue times, track duration and master revision. Changing a master must trigger a timing review rather than silently reusing cues for different audio.
5. Drive display from the actual recording clock so pause, seek and playback-rate changes remain aligned. Preview clip-relative time needs an explicit mapping to full-recording time; that mapping has not been implemented or certified by this visual change.
6. Add word-level cues as a separately validated richer cue format for karaoke highlighting. Do not approximate word timings by splitting a line's duration equally.

This is a recommended implementation sequence. No Musixmatch account, API subscription, external lyric import, automatic alignment engine, new timing editor or word-level synchronization was added during this change.

## Verification and deployment limits

- 146 Node regressions passed, covering credits, catalog, upload/publication and modal lifecycle/bridge paths.
- The new shared-owner regression fails against the preceding committed modal component with “Editorial and playback controls need one layout owner”; it passes with the repair.
- 17 simulated DOM checks passed using the production modal components, lyric panel and artwork hook with fixture auth/media/fetch boundaries. They cover both normal-flow control stacks, buttons, close/reset/Escape, credit scope, lyric containment, loading/retry/empty, portal mounting, timed line activation and no playback commands from editorial interactions. They cannot measure layout or actual pointer hit-testing.
- Changed-component ESLint: zero errors, six existing modal warnings. Production webpack build passed. The exact hosting result is recorded in the completion message.
- The supported Browser runtime and its documented troubleshooting returned no available browsers. No standalone browser bypass was used. Signed-in production taps, screenshots, native touch and physical-device behavior remain unverified.
- Latest remote HLS commit `ca456908` was fast-forwarded into this isolated deployment checkout before the layout fix. No original working-tree edits, new migrations or permanent production content changes are part of this repair.
