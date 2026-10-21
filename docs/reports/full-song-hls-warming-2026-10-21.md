# Full-song HLS retention and high-quality replay preparation

Approved implementation, October 21, 2026. Release base: 58d791c3 (preserves the newer credits, release-deletion, modal, and lyrics work). No database, entitlement, transcoder, or DSP changes.

## Findings and corrected contracts

The existing HLS player fixed a rendition for each play, but its decoded buffer stopped loading ahead at a bounded target. Its application cache held only 15 MiB of encrypted segments; requesting a different next-track preload cleared that cache. Consequently, a fixed rendition did not imply a downloaded whole song, and preparing another track discarded useful bytes. A differential check against the previous implementation fails when next-track preparation deletes a retained active segment; the new implementation preserves it.

The selected rendition now has a separate full-song download owner. It downloads encrypted segments beyond the decoded-buffer target, while retaining the bounded MediaSource buffer. A single scheduler prioritizes the selected rendition, then three opening segments for the next queued song, then the highest rendition of the current song for a future play. Only the active decoder owns the scheduler; standby initialization cannot steal that lease, and a committed representation-deck swap transfers it. It checks contiguous playback runway and yields on decoder demand, pause, stalls, source changes, and data-saving restrictions for speculative work. Requests, including their response bodies, have a 12-second deadline and bounded retries.

The fragment loader retains a snapshot of network-delivered ciphertext before hls.js transfers it to a decoder worker. Cache delivery remains excluded from bandwidth measurements. A 15 MiB memory layer fronts a 64 MiB / 1,024-entry browser CacheStorage budget. Eviction excludes the selected rendition where possible. Shared-cache inventory is refreshed on writes, with browser Web Locks coordinating writers where available. Private-mode denial or quota failure falls back to the memory layer and normal network playback.

A fresh authorized master is still fetched for each play. Its current manifest publication timestamp (or legacy prefix identity) versions variant and segment addresses. A changed publication cannot reuse readiness for the old bytes. Persistent descriptors contain only encrypted segment addresses; authorization tokens, key URLs, decryption keys, and plaintext audio are not persisted. Partially warmed or evicted renditions do not qualify as complete. A fully cached highest rendition is selected and held for an automatic-quality replay. An explicit user quality preference remains authoritative.

All post-startup HLS fatal paths share a guarded progressive handoff. It captures position before decoder teardown, refreshes authorization for the exact recording, preserves the queue occurrence, restores position, respects deliberate pause or a newer selection, coalesces duplicate callbacks, and requires media advancement before declaring success. Access denial remains terminal; other exhausted recovery failures expose retry without silently skipping an album song.

## Verification

- Failed-before / passed-after cache-retention check against unchanged previous application source.
- Playback, cache, route-version, catalog, release-availability, and newer credits regression suites: 271 passed on the latest production base.
- Playback Core invariant suite: 156 passed. Synchronized original checkout: 169 playback tests passed.
- Broader signal-path/architecture suite: 372 passed, six failed. The identical six failures reproduce on unchanged production base 3e73a339: preview-sheet safe areas, environment-variable documentation, route-audit count, podcast publication metadata, UploadWizard commonProps, and artwork video controls. No new failures were introduced by this patch.
- Targeted source lint: passed with no errors. Production Webpack build: passed (Next.js 16.2.4). Existing Sentry setup warnings remain.
- Simulated coverage includes partial/full warm readiness, decoder buffer transfer, persistent reload, version replacement, cache eviction/budget, concurrent writers, source-change cancellation, warm-request preemption, stalled response bodies, bounded failures, replay quality choice, album identity, pause, and authorization denial.

## Practical impact and limits

Expected benefit: completing a selected rendition makes its later segments available without another media download; spare delivery capacity prepares high-quality replays without changing the active play. This is verified as code behavior in simulated host/cache tests, not as measured audible improvement.

The application-controlled cache path applies to hls.js. Native HLS retains browser ownership and does not consume this fragment loader; full-song retention and high-quality warming are not claimed for that path. Browser eviction, unavailable storage, oversized recordings, and insufficient delivery capacity can prevent a complete cached song. Warming pauses while playback is paused or ended. Fresh authorization is still necessary for replay; this is not offline entitlement support.

The connected browser remained unavailable. Live playback, audible segment-boundary comparisons, Bluetooth behavior, real browser CacheStorage/eviction behavior, and a decoded-versus-processed audio comparison remain unverified. No claim is made that distortion is fixed, and no speculative change was made to compression, gain, EQ, encoding, or the original recordings.

Rollback: revert the implementation commit and redeploy the preceding application revision. There is no schema migration. Encrypted cache entries are disposable; previous clients ignore the added version query parameters.
