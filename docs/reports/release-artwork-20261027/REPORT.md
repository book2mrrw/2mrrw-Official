# Release artwork continuity repair

Status: source fix implemented and regression tested; browser/device rendering and deployment not verified.

Base: d013e32360e2a227b22241b190f1c7067d19e793 in isolated `release-track-artwork` worktree. This base matches the last recorded deployment in the existing playback artifact report; production was not independently queried in this task. No commit, push, deployment, database mutation or production setting change was performed.

## What was wrong and evidence

The user's report is artwork disappearing/changing as album, mixtape and EP tracks advance. Two source defects were reproduced with synthetic fixtures:

1. `resolveAlbumTrackPlaybackItem` inherited four flat artwork fields, but spread track/single fields such as `visual`, `motion_cover_url`, and `cover_art_url` remained. Later `normalizeTrackForPlayback` preferred those aliases and selected the single's artwork. Thus checking the immediate resolver output did not verify the player input. Fixtures reproduce release motion becoming single motion, including a static release incorrectly becoming animated.
2. `withR2CatalogMedia` cached the entire catalog object under a release slug with a media-only signature. Two recordings sharing slug/artwork/preview returned the first recording's title and trackSlug. Changes to baseCover alone also reused stale artwork.

`before.log`: six failed regressions and one passing standalone-single control. The initial fixture draft's null-account setup errors were corrected before this baseline was captured; those setup errors are not product failures. The two additional natural-completion/title-lookup tests were added after implementation.

## Architectural correction

The existing frozen still/motion descriptor now accompanies a release track occurrence as `releaseCoverIdentity`. The shared media normalizer honors that release-owned decision; the final catalog-to-playback conversion derives its cover, still and type from the same descriptor after legacy aliases are processed. Recording identity, audio, preview, gain, access and stream resolution remain independently owned. Standalone singles retain existing artwork rules.

The full-object cache now validates its full JSON catalog input rather than only media fields. The media equality signature also includes baseCover and coverArtType so those display changes can invalidate surface equality.

Connected source paths traced: catalog product projection -> catalog media normalization -> release track resolver -> `mapAlbumTracksForPlayback` / `albumTracksForPlayback` -> playable queue -> queue normalization -> natural `onEnded` authoritative handoff -> playback presentation -> GlobalAudioPlayerBar motion gate and image poster. Shared callers include release preview modal, player release modal, album tracklist sheet, My Music, radio, release cards and prewarm resolution. Queue/event handlers and the audio runtime/element owner were not changed.

## Files

- `apps/web/src/lib/music-playback.js:156`: carry the release descriptor; `:290`: enforce it at the playback conversion boundary.
- `apps/web/src/lib/media/r2-catalog-media.js:102`: full-input cache validity; `:157`: honor the release descriptor; `:29`: include still/type in media equality.
- `apps/web/src/lib/playback/__tests__/release-artwork-continuity.test.js:1`: nine behavioral regressions/controls.
- `apps/web/src/lib/media/__tests__/cover-descriptor.test.js:166`: replace an implementation-shaped regex with behavioral descriptor/legacy-field consistency checks. The old regex failed because it required the exact old assignment syntax, not because its intended invariant was violated.

## Verification

- Playback suite: `node --no-experimental-webstorage --experimental-test-module-mocks --import ./scripts/register-alias.mjs --test src/lib/playback/__tests__/*.test.js`: 251 passed, zero failed.
- Artwork neighbors: descriptor, media-session-artwork, db-cover-still-identity and cover-readiness: 36 passed, zero failed.
- Nine new continuity tests cover album/mixtape/EP, static releases, standalone singles, legacy title lookup, stale still cache, distinct recording metadata, and natural completion.
- The natural-ended test invokes real playback event handlers using the existing simulated host media fixture, captures the authoritative handoff, and verifies next-recording identity, queue occurrence, identical release motion/still and unchanged fixture audio reference. This is not browser, physical audio or video-decoder proof.
- ESLint on all four changed source/test files: passed.
- `git -c core.whitespace=cr-at-eol diff --check`: passed; existing music-playback.js CRLF convention preserved.
- Browser inventory: no connected browsers. No browser bypass, screenshots, authenticated UI, mobile device, Capacitor rendering or physical playback verification performed.
- Next.js webpack compile mode (`next build --webpack --experimental-build-mode compile`): passed; see `build.log`. Static generation was not run in this mode. Compilation is not functional playback proof.

## Positive impact and remaining acceptance

Verified in fixtures: each release track retains the release's still/motion artwork through playback conversion and automatic completion handoff, while tracks remain distinct. Static releases do not pick up a single's animation, and standalone singles keep their own artwork. No performance improvement was measured.

Expected live benefit after deployment: artwork stays consistent across the release queue, including the animated cover. Production deployment plus connected-browser/device playback remain required before claiming the user's live symptom is resolved.
