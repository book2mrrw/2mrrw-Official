# Phase 6 — Minimal Hardening Plan (ordered, low-risk)

1. **Add** `src/app/api/playback/events/route.js` — POST proxy to `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL/api/playback/events`; forward JSON body, `x-control-session-id`, cookies; OPTIONS 204; noop 204 if CS URL unset.
2. **Harden** `sendControlSystemPlaybackEvent` — on `!response.ok`, `console.debug` only in development (never throw; never `console.error`).
3. **Verify** `npm run build`.
4. **Probe** POST www.2mrrw.com/api/playback/events → expect 200 after deploy.
5. **Do not** modify `playTrack`, `seek`, `upgradeToFullStream`, or audio element lifecycle.
6. **Defer:** CS catalog same-origin proxy suite, stream 401, Printful errors, image pipeline.
