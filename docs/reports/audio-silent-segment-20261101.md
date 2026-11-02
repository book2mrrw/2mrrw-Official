# Audio verification correction — November 1, 2026

Valid short silent encrypted MPEG-TS segments were rejected by automatic format probing in the output peak gate. Reproduced in the existing independent ARM64 Docker image: codec acceptance 8/9, silent case failed before publication. This is an encoder verification defect, not proof of the cause of audible playback pops.

The shared worker measurement boundary now decrypts each actual encrypted segment independently, preserving AES padding boundaries, into an exclusive mode-0600 private file. It selects the known MPEG-TS demuxer explicitly, retains the existing decoded true-peak ceiling, and removes verification plaintext after success or failure. Published ciphertext, codec settings, player rendering and publication fences remain unchanged.

Affected owners: apps/web/workers/hls-transcoder/src/audio-headroom.js:37 and :52; src/transcoder.js:110. Negative/cleanup regressions: src/__tests__/encrypted-audio-measurement.test.js:24; connected publication tests: src/__tests__/audio-headroom-publication.test.js:14.

Verification: source/dependency review and git diff --check passed. Eight focused source tests passed. All 173 worker regressions passed inside the existing Linux ARM64 VM Docker runtime. Real FFmpeg 9.0.2/AES acceptance with corrected source and current verifier mounted read-only passed 9/9: high-peak source, FLAC/ALAC/AIFF, silence, source/profile rejection, decoder failure and isolation. The old verifier independently also needed explicit MPEG-TS selection; its current source already contains that correction. A bare-host full-suite attempt failed due to absent Supabase dependencies; the complete suite passed with image dependencies.

The verification container used existing image 86f6f70144d7, no network or credentials, non-root UID1001/GID999, read-only root/source, bounded writable scratch, dropped capabilities. This is actual container encoding evidence, not acceptance of a newly built immutable successor image or production playback/listening proof.

Expected benefit: valid silent outputs can qualify without bypassing quality checks; corrupt ciphertext and decoder failures still block publication and remove private bytes. No production deployment, migration, source rebuild or physical listening verification was performed. Retained logs: deployment-evidence/playback-deep-audit-20261027/verification-20261101/ in the parent workspace.
