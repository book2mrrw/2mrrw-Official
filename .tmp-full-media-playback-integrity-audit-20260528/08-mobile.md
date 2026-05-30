# 08 — Mobile (code-level + prior audits)

**No code changes in this audit.** Mobile uses same `AudioContext` + `GlobalAudioPlayerBar`.

## Code touchpoints

| Area | Mobile relevance |
|------|------------------|
| `unlockAudioFromGesture` | iOS Safari autoplay / silent until gesture |
| `resumeWebAudioContextIfSuspended` | WebAudio path after background |
| `libraryStreamRedirectSrc` | Fewer async steps — better for mobile latency |
| `credentials: "include"` on stream fetch | Requires SameSite cookies on Safari |
| Single `<audio>` in provider | Correct per platform rules |

## Documented regressions (prior audits — not re-proven live)

From `.tmp-mobile-audio-silent-audit-20260528/` and related:

- Session cookie not sent on first stream after cold load
- JSON prefetch + `assertSignedAudioUrl` HEAD failing on presigned URL (CORS)
- Competing gesture handlers / modal overlay blocking unlock
- `canStream` false while account state still loading → preview-only stuck state

## Mobile vs desktop divergence

**Minimal in playback code** — differences are environmental (Safari ITP, background tab suspend, Bluetooth route).

## QA focus (manual)

1. Guest: feature preview WAV on LTE
2. Subscriber: feature full play via redirect stream
3. Album modal: first track + queue advance
4. Background + lock screen controls
