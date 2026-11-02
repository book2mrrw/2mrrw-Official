# iOS Safari playback regression containment — November 1, 2026

## Confirmed incident and restoration

The listener reported that a fresh page load followed by Play on Love Hz Vol. 1 in mobile iOS Safari showed a connection error; repeating Play or selecting another recording did not recover it. Live deployment metadata identified fed2eb1e5d66baf1b49170ac600afc1e617de90d at dpl_GuqhYQYRtNzqJusSWQ6vnp5wVwNY, the startup release shipped in the preceding work.

Production was rolled back to fda45e505eadb17ee578c742a0af12ed62927a65 at dpl_AgLemEuQLAReZTv9ZcrfPDQACuqX. Both production aliases were read back and verified on that release. After refreshing the same iOS Safari/album, the user explicitly confirmed: "It plays now". This is actual user/device A/B evidence that the shipped change set regressed playback. It does not isolate one of the three code changes or establish the precise browser exception.

## What went wrong in the implementation and validation

The release changed gesture activation, decoder selection and readiness/error ownership together, without authenticated native Safari execution evidence. It treated native HLS format support as sufficient grounds to prefer a different decoder despite the existing MediaElementAudioSourceNode graph, audio-effect chain, lifecycle handlers and recovery system. A canPlayType result does not certify that full graph/lifecycle combination.

The new native startup fallback could choose the progressive source, while the pre-existing media-error owner also resolves progressive sources. That interaction was not tested with real native error delivery. The exact native-startup trigger and whether competing recovery occurred on the device remain unresolved. The 481 passing tests used simulated media objects; they did not instantiate Safari's native HLS decoder or prove encrypted audio through the physical output graph. Builds, alias checks and unauthenticated denials were insufficient release acceptance evidence for this change.

WebKit primary bug reports document native HLS/Web Audio graph limitations (https://bugs.webkit.org/show_bug.cgi?id=180696 and https://bugs.webkit.org/show_bug.cgi?id=306493). These support investigating the compatibility boundary; they do not prove that either specific WebKit defect occurred on this phone. The phone's native error/trace was unavailable, and no device-version assertion is made.

## Observed failing requests

Recent production logs for the failed release contained repeated /api/library/stream 404 responses for love-hz-vol-1, track 01-roll-call. The handler logged no audio resolved and returned MEDIA_UNAVAILABLE. GlobalAudioPlayerBar renders any streamRetryable state as "Connection lost — tap to retry", so this label does not identify an internet failure.

HLS master, variant and key requests had 200 entries during the same log window. Independent HEAD checks of the first encrypted 320k and 64k segments for the affected release returned 200 with video/mp2t and the expected www origin CORS header. These checks establish endpoint/object reachability, not successful decryption, rendering or audible output. The native browser failure that preceded the progressive 404 is not present in server request logs.

Read-only database inspection confirmed HLS manifests for the affected track and a catalog-track storage path. No rows were changed. A local R2 listing attempt lacked the bucket setting in the pulled local environment and therefore did not query the bucket; its empty results are NOT evidence of missing R2 audio. Deployment metadata does list R2/HLS environment names, so an earlier suspicion of missing production configuration is unconfirmed and is not the incident conclusion.

## Durable correction

The restoration commit removes only the iOS startup change set relative to merge parent fda45e50. It preserves that parent's quality/cache work, auth, encryption, queue implementation and migrations. All historical startup reports remain in Git for accountability. An isolated investigation branch preserves the failed source as an ancestor; no dirty worktree was reset or overwritten.

The resulting application runtime/configuration tree matches the user-verified fda45e50 source exactly. Historical reports are retained and one additional regression test guards the established decoder-selection boundary. This is a verified restoration, not a claim that the original first-tap reliability issue is permanently fixed. No speculative native-playback replacement is promoted.

## Verification and remaining work

- Production rollback succeeded; www.2mrrw.com and 2mrrw.com both resolve to dpl_AgLemEuQLAReZTv9ZcrfPDQACuqX / fda45e50.
- User confirmed playback works again after refreshing the same iOS Safari/album.
- Exact application runtime/configuration comparison against fda45e50 (excluding reports and the additional test) and CRLF-aware diff checks passed.
- Restored playback/Core suite: 456 passed (including the additional regression case), zero failed/cancelled/skipped, using the existing alias loader and experimental module mocks. Output: ios-regression-restoration-final-tests.txt; the preceding 455-case baseline output is also retained. Historical 481-test results are not represented as proof of successful device playback.
- No auth policy, encryption secret, production environment setting, database record, remote migration, media object or worker was changed.

Remaining blocker to a precise browser-level root cause: the connected-browser inventory is empty, and no iPhone Safari media/console trace is available. Capture source selection, play rejection name, media error code, readyState/networkState, actual event ordering, graph output/progress and the first source-replacement decision before redesigning startup again. The original first-tap requirement remains open; restored playback is the verified positive outcome of this incident response.

## Failed-before/passed-after decoder regression

The added test in hls-adaptation.test.js supplies both native-format and MSE support. It fails against the shipped fed2eb1e HLSEngine because the new policy constructs no MSE decoder, and passes on the restored implementation. The assertion covers the established graph-compatible transport contract. It does not simulate a genuine Safari decoder failure, so it is not represented as a reproduction of the phone's native exception. Before/after outputs are retained beside this report.
