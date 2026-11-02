# Audio verification correction — November 1, 2026

Valid short silent encrypted MPEG-TS segments were rejected by automatic format probing in the output peak gate. Reproduced in the existing independent ARM64 Docker image: codec acceptance 8/9, silent case failed before publication. This is an encoder verification defect, not proof of the cause of audible playback pops.

The shared worker measurement boundary now decrypts each actual encrypted segment independently, preserving AES padding boundaries, into an exclusive mode-0600 private file. It selects the known MPEG-TS demuxer explicitly, retains the existing decoded true-peak ceiling, and removes verification plaintext after success or failure. Published ciphertext, codec settings, player rendering and publication fences remain unchanged.

Affected owners: apps/web/workers/hls-transcoder/src/audio-headroom.js:37 and :52; src/transcoder.js:110. Negative/cleanup regressions: src/__tests__/encrypted-audio-measurement.test.js:24; connected publication tests: src/__tests__/audio-headroom-publication.test.js:14.

Verification: source/dependency review and git diff --check passed. Eight focused source tests passed. All 173 worker regressions passed inside the existing Linux ARM64 VM Docker runtime. Real FFmpeg 9.0.2/AES acceptance with corrected source and current verifier mounted read-only passed 9/9: high-peak source, FLAC/ALAC/AIFF, silence, source/profile rejection, decoder failure and isolation. The old verifier independently also needed explicit MPEG-TS selection; its current source already contains that correction. A bare-host full-suite attempt failed due to absent Supabase dependencies; the complete suite passed with image dependencies.

The verification container used existing image 86f6f70144d7, no network or credentials, non-root UID1001/GID999, read-only root/source, bounded writable scratch, dropped capabilities. This is actual container encoding evidence, not acceptance of a newly built immutable successor image or production playback/listening proof.

Expected benefit: valid silent outputs can qualify without bypassing quality checks; corrupt ciphertext and decoder failures still block publication and remove private bytes. No production deployment, migration, source rebuild or physical listening verification was performed. Retained logs: deployment-evidence/playback-deep-audit-20261027/verification-20261101/ in the parent workspace.

## Built-image verification

The independent successor image subsequently built successfully on the existing Mac Lima Linux ARM64 VM. Image content ID: `sha256:ab0b2a9511f8174655fa435f4023387cb42724c12705bbf457cea86b2914e303`; source label `9e8cf71f5c65c0d4e3ea6e0e9a7c6548de6fd4d9`; release fingerprint `6bd6beb707b8ddcaa23e21b38c364d55518e2e5d2e9e50fcc3039b4d1833e0c7`. Labels were read back from Docker. This is a local image content ID, not a published registry digest.

With no source overrides, actual image codec/encryption acceptance passed 9/9 and worker regressions passed 173/173. Missing credentials correctly refused queue-consumer startup with exit 1. All 44 foundation tests passed after allowing loopback-only test sockets. Logs and machine-readable result.json are retained in the parent workspace evidence directory linked above. The cloud preparer, codec input lock and status now point at this committed successor, and preparation generated 64 credential-free inputs. No image push, production worker deployment, DB migration or catalog rebuild occurred. Physical playback and delivered production media remain unverified.
