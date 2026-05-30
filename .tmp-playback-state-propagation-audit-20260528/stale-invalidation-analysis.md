# Stale Invalidation Analysis

## Mechanisms reviewed
- `activeCommandRef` stale cleanup (`ACTIVE_COMMAND_STALE_MS`)
- play request identity checks (`requestId !== playRequestIdRef.current`)
- command watchdog timeout + queue circuit fallback

## Findings
- Stale cleanup resets stuck active command metadata; it does not directly null `currentTrack`.
- Request ID guards can abort older in-flight work; this is expected race control.
- In this audit path, primary invisibility does not require stale invalidation to reproduce.

## Overreach assessment
- No direct evidence of stale invalidation overreaching into a hard suppression of all commits.
- Main suppression is semantic: `hasStarted` left false after successful same-track progression.

