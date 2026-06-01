# UI churn map (Phase 6C)

## Prefix

`[ui-churn]`

## Events (`page.js`)

| `kind` | Trigger | Key fields |
|--------|---------|------------|
| `scroll` | Main scroll container, 300ms throttle | `scrollTop`, `activeTab` |
| `intersection` | Audio Visuals IO | `target: audioVisuals`, `intersecting`, `ratio` |
| `intersection` | Home subsections IO | `target: vault\|cards\|shows`, `homeScroll: true` |
| `section-change` | `activeTab` change | `from`, `to` |
| `catalog-rerender` | `browseSingles` length change or `catalogLoading` | `catalogPage`, `singlesCount`, `catalogLoading` |

## Trace context side effects

`recordPlaybackTraceContext` updates used by pause snapshots:

- `lastScrollAt` — scroll handler
- `lastUiSection` — last IO target (`audioVisuals`, `vault`, etc.)
- `lastCatalogRenderAt` — catalog effect

## Audio Visuals → playback

When Audio Visuals enters view, `onAudioVisualsFocused` runs (existing behavior). Trace logs IO **before** that callback — use to confirm classification **A** when music stops near the visuals block.

## Refs only

No new React state for tracing; uses `useRef` throttles and previous-value refs.
