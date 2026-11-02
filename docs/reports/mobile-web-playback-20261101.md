# Mobile web playback release — November 1, 2026

Scope: existing live website, including mobile browsers. Based on verified current production commit 2ba6a47468e7272c47b353a436ba296e0bcee1da (Vercel dpl_FocT3ivNKwb129KrZxheLckZDh9L). Native app, worker deployment, database migration and media regeneration are separate.

Confirmed source/reproduced defects: HLS could select multiple encodes before its late quality hold; hls.js error recovery could clear manual selection; download speculation could compete with current playback; decoder-rejected bytes could re-enter caches. Post-lock progressive fallback could silently substitute a different encode. These are verified conflicts, not a device-level attribution of every reported click.

Shared owners corrected: src/lib/audio/HLSEngine.js:145 (native single rendition), :437 (selection before first fragment), :296 (decoder rejection); hls-segment-cache.js:23 and encrypted-segment-store.js (quarantine/eviction); hls-download-manager.js and hls-prefetch-loader.js (selected-rendition/foreground ownership); src/lib/playback/hls-fallback.js:22 (retain locked quality). All paths are under apps/web/. No React rendering, player remount, backend contract or audio-effect graph changes.

The selected HLS rendition remains fixed through playback and retry bounds. Exhausted locked recovery now exposes the existing retryable interruption instead of silently changing encoding. Startup fallback remains available. This favors the requested quality consistency; it is not a promise of uninterrupted playback under every failure.

Verification: all 259 playback tests passed on the isolated production-based release, including native HLS selection, stale requests, recovery, persistent/memory cache rejection, foreground fetches and full-song download ownership. git diff --check passed. Lint and actual Vercel production-build/deployment evidence are recorded in the accompanying deployment evidence directory. Software tests and deployment success do not certify physical-device sound.

Expected impact: prevents the reproduced mid-play encode changes, rejected-cache replay and competing speculation. Already encoded catalog files are unchanged. The server encoding/publication improvements and short-silence worker fix remain outside this web release; they are not represented as live. Physical mobile-browser listening is still required to determine the reported audible result.
