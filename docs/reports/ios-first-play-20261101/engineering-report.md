# iOS first-play architectural repair — 2026-11-01

## Scope, lineage, and root cause

Implemented the three authorized changes in order in the isolated ios-first-play-release worktree. Live Vercel deployment metadata and remote main both identified 2ba6a47468e7272c47b353a436ba296e0bcee1da as the production baseline (deployment dpl_FocT3ivNKwb129KrZxheLckZDh9L, READY). Existing dirty worktrees, artwork continuity, audio-integrity migration work and cloud replacement work were not overwritten or included. The Capacitor application's absent player is outside this website fix.

The source-level failure chain was: a separate zero-sample silent element was assumed to transfer playback permission to the actual element; MSE capability overrode native HLS support; the actual player waited for decoded data before asking native playback to begin. A permission rejection then became a generic retry prompt. These contracts were confirmed in source and simulated reproductions; no trace established which branch occurred on the reported physical iPhone. Android's reported success is user evidence, not a measured comparison from this implementation session. Different activation/transport/loading behavior remains the explanation to validate on devices.

## 1. Activation ownership — PASS in source and simulations

The dispatcher calls captureMediaActivation synchronously on the existing persistent element, after synchronous Web Audio initialization/resume and before queued asynchronous work. It no longer constructs a separate silent Audio instance. Only a genuinely empty element during an active browser user gesture is prepared, using a valid finite 20 ms PCM WAV containing silence. Loaded or playing content, position, and volume are untouched. This prepares the same element; it does not authorize protected content or claim page-wide autoplay permission.

Preparation ends on its play result, cancellation, or a 1.5-second deadline; this deadline is a failure bound, not a fixed startup delay. The command queue waits for preparation only when an operation actually exists. Emergency pause/stop cancels it. Late completion cannot pause a successor source. WebAudioEngine isolates preparation and queued handoff events until the real source starts loading, so silent preparation cannot advance the queue, publish playback, or feed track error/duration/progress handlers. Runtime/element construction and the existing graph binding are retained.

## 2. Decoder selection — PASS in source and simulations

playback-capabilities.js owns the capability policy: native HLS first, otherwise supported hls.js/MSE, otherwise unsupported. HLSEngine decides before importing or constructing hls.js and exposes its selected transport. Native AVPlayer receives the existing authenticated HLS URL; hls.js remains the MSE implementation for other browsers. prewarmHLS and isHlsJsActive use the same persistent element/capability policy, preventing a native player from triggering the hls.js prefetch path. Existing production quality selection, native master behavior, MSE cache/download leases and generation guards are retained. Unshipped audio-integrity changes were not deployed by this patch.

## 3. Readiness, recovery, and diagnostics — PASS in source and simulations

Native HLS and native progressive startup use playback-driven readiness: source preparation does not require decoded frames before the real play request. MSE retains its existing buffered-runway gate and startup fallback. Native HLS is not discarded merely because pre-play readyState is below 2.

media-play-request.js owns bounded play completion, error-event observation, cancellation and late-result source ownership. Both shared audio-element play helpers use it. The default 12-second startup bound fits inside the existing command watchdog. AbortError retries remain bounded in the existing guarded helper; permission denials are classified and never blindly retried. All actual protected playback attempts retain the existing physical-effect guard.

After an actual native startup network/media/unsupported/timeout failure, the stream command can try its already-authorized protected progressive route once under the same live intent and authority. Permission/authentication failures do not select this fallback. Deliberate pause, aborted loads and superseded generations cannot restart playback or initiate fallback. The fallback rechecks physical-effect authority. Diagnostic payloads retain exception name, numeric code including zero, safe failure category and stage; no signed URLs, key bytes or credentials are added to telemetry.

## Verification

Final command from apps/web:

```sh
node --experimental-test-module-mocks --import ./scripts/register-alias.mjs --test src/lib/playback/__tests__/*.test.js src/lib/playback-core/__tests__/invariants.test.js src/lib/playback-core/__tests__/physical/*.test.mjs
```

Result: 472 tests passed, zero failed/cancelled/skipped. This consists of 276 playback tests and 196 Core/authority tests. Twenty-five new cases were added (activation 7, dispatcher integration 2, dual decoder capability 1, startup helpers 9, real stream service 6). Existing neighboring checks cover queue completion, release artwork identity, previews, pending seeks, duration limits, source/access changes, lifecycle interruptions, bounded convergence, leases/cache behavior and physical-effect authorization. Tests named physical use simulated media; they are not physical-device results. Raw final output: verification-final.txt.

New connected tests invoke the real dispatcher and stream command owner, checking synchronous activation on the same object, serial handoff, emergency pause, metadata-only native startup, exactly one initial native play call, one controlled protected fallback, permission rejection, cancellation, rechecked authority and preview access stamps. Fake timers prove native startup bypasses the old six-second prebuffer wait; no audible startup improvement was measured.

Focused ESLint on all changed source/test files passed with no output. git -c core.whitespace=cr-at-eol diff --check passed, respecting existing CRLF files. Source/dependency review retained resumeInternal's initWebAudio call and shared helper coverage. No package manifest or lockfile changes were required.

The final production Vercel build passed (build-verified.txt) with the frozen source and production project settings. Earlier setup failures are preserved: the first Vercel build ran from apps/web while the project rootDirectory is already apps/web; a later build rejected an external node_modules symlink. Both were resolved in the isolated worktree. A test run during dependency installation also saw incomplete AWS SDK imports; after installation completed, the full final suite passed. These were harness/build setup failures, not suppressed application test failures. Existing module-type, experimental mock and Sentry deprecation warnings remain.

## Security and preservation

No auth handler, entitlement rule, HMAC derivation/token authority, encryption, Supabase schema, storage permission, CORS setting, production configuration, or remote migration changed. Native and fallback media still pass through the existing server-protected routes. Audible-effect guards remain enforced and negative tests prove denied fallback does not play. This is not a media revocation certification.

No second playback element, engine, framework, or dependency was introduced. Existing audio runtime and element identity are retained in the simulated dispatcher tests. No physical-device position/identity measurement was possible. The separate Capacitor app was not changed.

## Runtime evidence and limits

Connected-browser discovery returned an empty inventory. iPhone Safari, iPhone Chrome, Motorola Chrome, desktop Safari and desktop Chrome audible playback remain UNVERIFIED. Cellular/Wi-Fi, cold authentication, actual playlist/key/segment request timing, 206 behavior, decoded audio and first audible output have not been measured. A successful build/deployment or HTTP probe does not establish them.

Production deployment identity and post-deployment HTTP verification are recorded separately after the release commit. This report does not claim deployment success in advance. Rollback target is the previously verified production deployment and its baseline commit above; the patch requires no migration or configuration rollback.

## Practical impact

Verified in simulations: activation belongs to the intended element, native support wins over MSE, metadata-only startup no longer spends the old prebuffer budget, startup is bounded/cancellable, source fallback is controlled, and permission failures remain diagnosable. Expected device benefit: fewer avoidable first-play stalls and second-press failures. Actual iPhone improvement and cross-device parity require the device matrix above.

## Changed files

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
