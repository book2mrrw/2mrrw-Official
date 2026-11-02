# Integrated iOS playback release — 2026-11-01

This report supersedes the final-release statements in engineering-report.md while preserving that initial implementation report and its evidence.

## Deployment concurrency and preservation

Initial implementation was correctly based on the then-live 2ba6a474 production revision and passed 472 tests. During that work a separate release deployed fda45e505eadb17ee578c742a0af12ed62927a65, adding locked native/MSE renditions, cache quarantine and foreground fetch coordination. A later deployment check found this change. The first iOS commit 4c8dc7cc8229908e2c9062a5a4f267c9fb3917de had already finished deploying before its cancellation request; production was successfully rolled back to the newer quality/cache deployment dpl_AgLemEuQLAReZTv9ZcrfPDQACuqX while integration proceeded. The rollback and alias readback are recorded in the external ios-first-play-deployment-20261101 evidence directory.

The integrated release merges fda45e50 and 4c8dc7cc without rewriting either history. All cache quarantine, leases, manual quality preservation and post-lock recovery changes are retained. Native HLS selects exactly one authorized variant, preserving the newer release's quality contract. It does not hand the adaptive master directly to AVPlayer. The standalone audio-integrity worker/database changes remain outside this release.

## Three architectural corrections, in order

1. The existing dispatcher captures cold gesture activation on the actual persistent audio element using valid finite silent PCM; no separate unlock element or page-wide permission assumption remains. Preparation is bounded/cancellable, loaded media remains untouched, and preparation/handoff events do not become track events. The queue waits for preparation before source loading; audible content still requires existing Core physical-effect authority.
2. Shared capability policy selects native HLS before MSE, and prewarm/prefetch use that same policy. The merged native path fetches the authenticated master, selects its authorized single rendition, preserves quality locking, and assigns it to the same audio element.
3. Native playback drives its own readiness instead of waiting for MSE prebuffering. Both shared play helpers use bounded play requests. Generation/source ownership and pause cancel stale startup; permission errors are classified without blind retry. One protected startup fallback remains available after an actual recoverable native failure, under the same live intent and a rechecked authority guard. Existing post-startup locked-quality failures do not silently substitute a different encode. Exception names, numeric codes including zero, category and stage survive diagnostics without logging tokens/keys.

## Additional confirmed iOS-relevant root cause found during integration

The newly deployed native quality selector indexed variants with the network-hint value directly. getStartupQualityLevel returns -1 when Network Information API hints are absent, as on Safari. This selected variants[-1], rejected the otherwise valid native playlist and forced progressive fallback. Five real stream-service integration tests failed on that branch (verification-integrated.txt, retained locally). The correction reuses qualityTierLevel and its existing highest-rendition fallback, matching the MSE contract rather than inventing another browser-specific default. The explicit no-network-hint native test and the real stream-service tests now pass. This confirms a source-level defect; it does not establish that the listener's earlier physical iPhone failure traversed that code.

## Final verification

481 tests passed; zero failures, cancellations or skips. This includes 285 playback tests and 196 Core/authority tests, with the concurrent quality/cache tests preserved. Twenty-six new tests belong to the iOS repair: activation 7, real dispatcher 2, dual capability/no-network native selection 2, startup helpers 9, and real stream command service 6. Verification command from apps/web:

```sh
node --experimental-test-module-mocks --import ./scripts/register-alias.mjs --test src/lib/playback/__tests__/*.test.js src/lib/playback-core/__tests__/invariants.test.js src/lib/playback-core/__tests__/physical/*.test.mjs
```

Raw semantic output (trailing whitespace normalized) is verification-integrated-final.txt. Build: `vercel build --prod` from repository root with the existing project rootDirectory=apps/web; passed, recorded in build-integrated-final.txt. Focused ESLint on the integrated files passed (lint-integrated-final.txt); the remaining iOS files passed lint-release.txt. Diff check passed with existing CRLF handling. integrated-source-manifest.json identifies the exact tested source bytes. Package manifests and lockfiles are unchanged.

Coverage includes cold metadata-only native start, one initial play request, controlled one-attempt startup fallback, permission denial, rejected fallback authority, explicit pause during startup, late promise/source ownership, preview access, MSE startup gates, stale generation, queue completion, release artwork, quality locking, cache quarantine, foreground fetch ownership, pending seeks and Core audibility guards. Media and physical suites use simulated browser/media objects. The build is actual production-mode compilation, not audible playback proof.

## Security, practical impact and limitations

No authorization route, entitlement check, HMAC authority, encryption, storage permission, CORS setting, production environment setting or remote migration changed. No second playback engine/element or dependency was added. Persistent runtime/element identity is retained in simulated dispatcher tests. Native and progressive fallback paths remain server-protected, and denied effect authority prevents playback.

Verified software impact: native-capable browsers retain the proper decoder and one selected rendition even without network hints; metadata-only native preparation does not spend the old six-second buffer gate; first-play commands remain bounded/cancellable; diagnostics distinguish permission failures. Expected benefit: fewer avoidable loading cycles/second-press failures while preserving quality/cache work. No physical startup latency or audible improvement was measured.

Connected-browser inventory was empty. iPhone Safari/Chrome, Motorola Chrome, desktop Safari/Chrome, cellular/Wi-Fi, real encrypted-media delivery, actual runtime element identity and audible playback remain unverified. The Capacitor application's absent player was not changed. Production deployment/HTTP evidence is recorded separately after this merge commit. A READY deployment or HTTP response is not proof that first audible playback succeeds on iPhone.

Implementation/test status for all three workstreams: PASS at source/simulation/build level. Physical-device acceptance: UNVERIFIED.

## Changed iOS source and tests relative to the preserved quality/cache release

- `apps/web/src/lib/audio/HLSEngine.js`
- `apps/web/src/lib/audio/WebAudioEngine.js`
- `apps/web/src/lib/audio/audio-element-utils.js`
- `apps/web/src/lib/audio/media-activation.js`
- `apps/web/src/lib/audio/media-play-request.js`
- `apps/web/src/lib/audio/playback-buffer.js`
- `apps/web/src/lib/audio/playback-capabilities.js`
- `apps/web/src/lib/playback-core/production/wireProductionCore.js`
- `apps/web/src/lib/playback/PlaybackStreamCommands.js`
- `apps/web/src/lib/playback/PlaybackTransportCommands.js`
- `apps/web/src/lib/playback/__tests__/hls-adaptation.test.js`
- `apps/web/src/lib/playback/__tests__/media-activation-dispatch.test.js`
- `apps/web/src/lib/playback/__tests__/media-activation.test.js`
- `apps/web/src/lib/playback/__tests__/native-startup.test.js`
- `apps/web/src/lib/playback/__tests__/native-stream-service.test.js`
- `apps/web/src/lib/playback/command-dispatcher.js`
- `apps/web/src/lib/playback/playback-diagnostics.js`
