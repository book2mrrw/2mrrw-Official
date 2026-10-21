# Audio recovery and album continuity — October 21, 2026

## Root causes and corrected behavior

Interruption handling could clear `isPlaying` before recovery inspected it. Hard recovery required that UI flag before attempting playback, yet could return success without calling `play()`. Recovery now follows continuing intent, honors effect authority and deliberate pause, awaits the existing media/context, and confirms media advancement before reporting success. Native play events cannot prematurely publish recovery as successful. Pending browser promises have deadlines and cannot overwrite newer selections, pauses or request generations.

Album media-error recovery omitted the individual recording and requested only the release. The server interpreted that as its first track. Recovery, resume and visibility refresh now share exact recording/release resolution. Returned identities are validated before application; ambiguous or mismatching album responses fail explicitly. The authenticated endpoint retains entitlement enforcement. No server policy, database, infrastructure or migration changed.

Completion previously advanced the queue index before asking Core to accept the successor and ignored rejection. It now commits the index after acceptance and exposes a retryable failure on rejection. Failed recovery retains the selected occurrence instead of silently spending an arbitrary album track. Queue exhaustion, repeat, shuffle, preview and sleep retain their existing owners.

Core bounded each convergence pass but scheduled another after every failure. Attempts are now bounded across passes to three per corrective step and desired revision, with backoff and terminal notification. A new authoritative intent gets a fresh budget and preserves synchronous gesture dispatch. The runtime probe checks actual element/context disposition before describing transport as playing.

## Architecture and files

- `PlaybackRecoveryCommands.js`, `PlaybackHelperService.js`, `recovery-operation.js`, `recovery-deadline.js`: current-owner guards, verified media confirmation, coalescing, deadlines and retained position.
- `output-route-recovery.js`, `usePlaybackEffects.js`, `WebAudioEngine.js`: device/context/supported sink hints reconcile the existing pipeline. Ordinary route changes do not reload, seek, recreate the element/context or reset the queue.
- `PlaybackEventHandlers.js`, `stream-client.js`, `PlaybackTransportCommands.js`: exact-recording retries and response validation, stale-response exclusion, explicit handoff outcomes and finite media-error retry.
- `playback-core/convergence/ConvergenceEngine.js`, `PhysicalStateProbe.js`, `production/wireProductionCore.js`: bounded convergence and terminal notification.
- `audio-engine-runtime.js`, `usePlaybackRefs.js`, `PlaybackStateMachine.js`, `audio-element-utils.js`: persistent coordination refs, stale orchestration exclusion, guarded play and failed-source readiness.

Reload is restricted to failed/detached sources and preserves recording and actual position. Route recovery has three attempts per coalesced episode and a cooldown after exhaustion. Media-error resolution has three attempts; each resolver request has a 12-second deadline. Context/play actions have two-second deadlines and media confirmation waits up to 750 ms. Browser-required interaction ends in an explicit tap-to-resume state.

## Evidence and verification

The two original defect tests fail on unchanged deployment baseline `78307732bbb4942f946a6cb1b01a25fcfad579d1`: recovery calls play zero times instead of once, and album retry omits `song-three`. Both pass with the fix.

- **44 new deterministic tests passed:** interrupted UI state; rejected/ineffective/pending play; deliberate pause; late completions; duplicate/stale recovery; exact recording/response identity; authorization denial; bounded media/Core retries; device bursts/delayed readiness; supported sink hints; no unnecessary recreation/reset; handoff rejection.
- **170 playback/catalog/release checks passed**, including those new tests.
- **156 Core invariants passed.**
- **40 simulated transport/effect-authority/geometry checks passed.** The suite's `physical` directory name does not mean physical devices were used.
- **Local production-mode Webpack build passed.** Local default Turbopack rejects the isolated checkout's external dependency symlink; the deployment build uses installed dependencies.
- **Targeted default lint:** zero errors, 37 hook-dependency warnings. An optional stricter `no-undef` check also identifies two existing `queue`/`idx` references in the unrelated hover-preload helper, present on the unchanged baseline.
- **Architecture:** 365 passed; three failures reproduced on the unchanged baseline: environment-variable documentation, route-audit count and artwork-control assertions. No unrelated repair was included.

From `apps/web`, the relevant commands are:

```sh
node --experimental-vm-modules --no-experimental-webstorage --experimental-test-module-mocks --import ./scripts/register-alias.mjs --test src/lib/playback/__tests__/*.test.js src/lib/media/__tests__/catalog-db.test.js src/lib/storefront/__tests__/catalog-refresh-contract.test.js src/lib/releases/__tests__/release-availability.test.js
node --test src/lib/playback-core/__tests__/invariants.test.js
node --experimental-loader ./src/lib/playback-core/__tests__/physical/alias-loader.mjs --test src/lib/playback-core/__tests__/physical/differential.test.mjs src/lib/playback-core/__tests__/physical/effect-authority.test.mjs src/lib/playback-core/__tests__/physical/hardening-b.test.mjs src/lib/playback-core/__tests__/physical/geometry-isolation.test.mjs
node_modules/.bin/next build --webpack
```

## Practical impact and limits

Verified in simulations: recovery does not falsely succeed while unintentionally paused; recovery of song three does not substitute song one; stale work cannot replace newer intent; repeated failures terminate. Expected benefit is fewer interruptions requiring refresh and correct recovery of the selected album song. No device-level improvement metric is claimed.

Device/sink-change events are hints. Browser/OS APIs do not expose every Bluetooth transition, allow automatic resume in every interruption or prove sound at a particular speaker. The connected browser remained unavailable after a CLI app relaunch. A standalone fixture did not complete successfully and is not counted as verification. No audible Bluetooth, vehicle, foldable, lock-screen or physical-device test is claimed.

The release was prepared from the current remote branch in an isolated worktree; unrelated pre-existing local work was excluded. Commit/deployment/alias identities are reported after the authorized push. A successful deployment or HTTP response is not a functional playback test.
