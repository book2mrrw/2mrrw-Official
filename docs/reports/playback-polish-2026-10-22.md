# Playback startup and segment-delivery polish

Approved scope: address the three read-only findings in priority order, without changing the fixed-rendition-per-play contract. Base: 4d993391; newer modal, lyric timing, and release edits are preserved.

1. The fragment loader previously aborted the scheduler even when both needed the identical versioned segment. The shared download owner now lends that pending response to the decoder. Each borrower gets owned bytes. Buffering hints do not cancel a response being consumed by the decoder. A 40 ms urgent / 100 ms buffered deadline abandons a slow borrowed request and invokes the normal hls.js loader once. Abort, destroy, track changes, and request generations guard late delivery. Shared partial-transfer timing is excluded from ABR measurements.
2. A memory miss previously waited up to 200 ms for disk before beginning a network request. A non-blocking, short-lived address inventory now identifies known misses, which bypass disk. Unknown reads use the same 40/100 ms delivery budgets based on contiguous runway. Inventory failure is conservative and does not prevent playback. Existing default hls.js retry/error handling remains the network fallback.
3. Highest-rendition readiness previously checked each segment sequentially on the startup path, potentially exhausting its budget despite all bytes being present. Completeness now checks groups of eight concurrently under one total 400 ms budget. Prewarming prepares the address inventory alongside HLS import and manifest loading. Every segment is still checked; the inventory alone is never completeness proof. Fresh master authorization, publication version identities, explicit quality preferences, encryption, and key delivery are unchanged.

## Evidence and verification

- Identical regression fixtures fail on unchanged production source for duplicate-download reuse and sequential startup checks, then pass with the patch.
- Five new focused tests cover exact pending-request reuse, buffering, partial-transfer provenance, bounded fallback, cancellation, known misses, unknown-read deadlines, parallel completeness, missing segments, and replacement identities.
- Playback/cache/route/catalog/release/credits/lyrics regressions: 296 passed.
- Playback Core invariants: 156 passed.
- Broader architecture/signal-path suite: 372 passed, six failed. The identical six failures reproduce on unchanged base 4d993391 (safe-area layout, environment documentation, route count, podcast publication metadata, UploadWizard commonProps, artwork controls).
- Targeted lint passed. Production Webpack build passed.
- In the deterministic slow-storage fixture, ten checks finish in two 70 ms batches (140 ms simulated time), whereas the previous sequential implementation does not finish in that interval. Urgent cache fallback is verified at 40 ms; these are simulated timings, not production performance measurements.

## Impact and limits

Expected benefits: preserve useful downloaded bytes instead of restarting an identical request, reduce avoidable delivery delay when the buffer is low, and reduce startup work for warmed replays. No measured improvement in audible output is claimed. The connected browser remains unavailable; live listening, the reported brief stutter, real cache/CPU timing, and Bluetooth behavior remain unverified. Native HLS remains browser-controlled.

No DSP, codec, database, entitlement, or infrastructure changes. Rollback is an application revert and redeployment; existing encrypted cache entries remain compatible.
