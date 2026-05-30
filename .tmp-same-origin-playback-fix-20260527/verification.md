# Verification

## Build

- Command: `npm run build`
- Result: **PASS** (exit code `0`)
- Notes: Existing Next.js metadata `themeColor` warnings were emitted; no build failure.

## Targeted checks

- Search for `2mrrw-control-system.vercel.app|NEXT_PUBLIC_API_URL|API_BASE_URL` under `src/`:
  - Result: no matches.
- Confirm playback/sync callers still route through shared builder:
  - `src/lib/control-system/playback.js` uses `buildControlSystemUrl("/api/playback/events")`
  - `src/hooks/sync/useRealtimeEvents.js` uses `buildControlSystemUrl("/api/sync/replay")` and `buildControlSystemUrl("/api/sync/stream")`
- Absolute `https://` fetches remaining in `src/` are non-playback server integrations (Printful/Resend) only.
