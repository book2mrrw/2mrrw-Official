# Files Changed

- `src/context/AudioContext.js`
  - Added centralized serialized playback command dispatcher/executor.
  - Routed public mutators through command authority.
  - Added structured diagnostics in playback-critical catches.
  - Routed visibility recovery through command dispatcher.
- `src/lib/playback/playback-diagnostics.js`
  - New helper for structured playback diagnostic reporting.
- `src/lib/playback/stream-client.js`
  - Replaced silent catches with explicit warning logs including context.
