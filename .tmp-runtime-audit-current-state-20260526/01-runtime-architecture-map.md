# 01 Runtime Architecture Map

## Current runtime map (storefront -> control -> media)
1. Storefront UI resolves access and playback source in `resolveTrackAccess` + `resolvePlaybackSrc` (`src/lib/music-access.js:103`, `src/lib/music-access.js:214`).
2. Entitled playback source is `/api/library/stream?slug=...&redirect=1` (`src/lib/music-access.js:206`).
3. Audio engine (`AudioContext`) detects library stream source and fetches signed stream metadata before/while play path (`src/context/AudioContext.js:967`, `src/context/AudioContext.js:795`).
4. Client stream helper targets `/api/library/stream` (`src/lib/playback/stream-client.js:3`, `src/lib/playback/stream-client.js:61`).
5. Storefront API route checks entitlement (`userCanStreamProduct`) and mints/returns signed URL via stream URL cache (`src/app/api/library/stream/route.js:41`, `src/app/api/library/stream/route.js:77`; `src/lib/playback/stream-url-cache.js:12`).
6. Control System exposes catalog/event endpoints with dynamic origin-based CORS for storefront origins (`/Users/recharge/2MRRW-Control-System/src/app/api/releases/route.ts:12`, `/Users/recharge/2MRRW-Control-System/src/app/api/sync/stream/route.ts:5`).

## Host and origin shape (runtime-observed)
- `https://2mrrw.com` redirects to `https://www.2mrrw.com` (probe evidence in `raw/01-origin-and-cors-probes.txt`).
- Control System CORS echoes both `https://www.2mrrw.com` and `https://2mrrw.com` on tested endpoints (same raw file).
