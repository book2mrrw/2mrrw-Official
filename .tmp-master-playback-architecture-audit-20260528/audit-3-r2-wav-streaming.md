# Audit 3: R2 + WAV Streaming Integrity

## 1) Confirmed problems
- Stream route creates stream session and event prior to confirming client can actually consume signed URL (`src/app/api/library/stream/route.js`, `src/lib/playback/stream-pipeline.js`).
- Redirect path attempts to forward `Range` in redirect response headers, but range semantics ultimately depend on the signed URL target behavior (redirect responses do not guarantee byte-serving by themselves).
- Stream client always performs HEAD verification against signed URL (`assertSignedAudioUrl`) before playback path completion, adding latency and extra failure surface on constrained mobile networks (`src/lib/playback/stream-client.js`).
- Signed URL cache TTL (8 min) differs from signed URL expiry (1 hour); invalidation and refresh policy split across server and client can drift (`src/lib/playback/stream-url-cache.js`, `src/lib/playback/stream-client.js`).
- Playback key resolution depends on product/content mapping that can silently return null when data model fields drift (`src/lib/playback/resolve-playback-key.js`).

## 2) Potential future risks
- Large WAV assets are more sensitive to startup/seek performance and can amplify resume/fallback races.
- Mixed mp3/wav catalogs can surface content-type edge cases if upstream metadata is inconsistent.

## 3) Race conditions
- **RC-6:** stream cache hit returns URL while client metadata deems it near-expiry; refresh and playback swap races.
- **RC-7:** session clear/create and force play across devices can rapidly churn rows with eventual consistency windows.

## 4) Mobile-specific risks
- Mobile radio variability makes HEAD+GET chain brittle for fast starts.
- Large WAV first-byte cost can trip buffering/error fallback loops faster than mp3.

## 5) App-transition risks
- Background/foreground with expiring signed URLs can force mid-session source swap, especially after long hidden periods.

## 6) Hidden architectural divergence
- Server path supports `redirect=1` fast path while client still has JSON-prefetch + HEAD validation path; both coexist and diverge behaviorally.

## 7) Memory leak risks
- Stream meta/session refs are manual and can become stale when fast request churn occurs.

## 8) Hydration/remount risks
- Entitlement hydration lags can start preview path then upgrade path; repeated source swapping during hydration windows.

## 9) Async-flow instability
- `fetchLibraryStream` error mapping (401/403/404/409) is handled in several call sites with subtle policy differences.

## 10) Exact file-level remediation recommendations
- Introduce a single stream contract with versioned response and explicit capability fields (`supportsRange`, `contentType`, `expiresAt`):
  - `src/app/api/library/stream/route.js`
  - `src/lib/playback/stream-client.js`
- Unify fast-path strategy: either true redirect-first or JSON-first, not both active by default:
  - `src/lib/music-access.js` (`libraryStreamRedirectSrc`)
  - `src/context/AudioContext.js` (`playTrack` stream path)
  - `src/lib/playback/stream-client.js`
- Make stream session lifecycle idempotent and tied to playback acknowledgement (server-side):
  - `src/lib/playback/stream-pipeline.js`
  - `src/app/api/library/stream/route.js`
- Add server-side integration tests for:
  - 206 range responses through signed URL
  - WAV content-type acceptance
  - concurrent stream force behavior
  - stale signed URL refresh.

## 11) Priority (critical/high/medium/low)
- **Critical:** unify stream contract + single fast-path policy.
- **High:** session lifecycle idempotency and acknowledgement semantics.
- **Medium:** remove redundant HEAD checks where server contract already validates.
- **Low:** cache TTL harmonization tuning.
