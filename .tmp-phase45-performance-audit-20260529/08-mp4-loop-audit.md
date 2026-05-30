# 08 — MP4 Loop Audit (Size, Decode Pressure, Visibility, Simultaneous Decodes)

## Inventory of `<video>` usage

| Location | Purpose | Attributes | Visibility control |
|----------|---------|------------|-------------------|
| `src/app/page.js` L1783 | Hero cinematic loop | autoPlay, muted, loop, **preload="auto"** | Always on Home |
| `src/components/home/LatestSinglesStyleRow.js` L103 | Single card loops | muted, loop, preload="metadata", poster | pause off-screen via scroll sync |
| `src/components/ui/CoverArt.js` L83 | Cover-as-video | autoPlay, loop, muted | Per card |
| `src/components/home/AmbientPlaybackBackground.js` L41,62 | Blurred ambience | autoPlay, loop, muted, blur(120px) | When track playing |
| `src/components/collectors-cards/CollectorCardItem.js` L38 | Card motion | data-cinematic-video | Cards tab |
| `src/components/collectors-cards/CollectorCardModal.js` L156 | Modal loop | data-cinematic-video | Modal open |

## Asset path

Videos resolve via `catalogMotionVideoUrl()` → R2 public CDN (`src/lib/media-urls.js`, `src/lib/storage/r2-public-cdn.js`).

Example hero: `videos/A2B.mp4` (exact byte size not measured — validate via CDN HEAD).

## Decode pressure model (Home tab, mobile)

**Worst case simultaneous:**
- 1 hero video (always playing)
- 1–3 singles carousel videos in viewport (playing)
- 0–1 ambient video (if audio playing + video cover)
- **Total: 2–5 concurrent decoders**

Safari typically limits smooth playback beyond 2–3 HD decodes on older devices.

## preload strategy

| preload | Count | Assessment |
|---------|-------|------------|
| auto | Hero + CoverArt + Ambient | Aggressive — bandwidth + decode |
| metadata | Singles row | Reasonable |
| default | CoverArt video | Browser default |

## Visibility / pause logic

**Singles carousel:** `syncSinglesCarouselVideos` in `page.js` L631–641
- Plays only when card fully in viewport (`rect.left >= 0 && rect.right <= vw`)
- Strict — partial cards paused

**No global video observer** for hero — always decodes.

## data-cinematic-video

Used in collector components — guardrail-protected cinematic system. Do not remove without explicit scope.

## Findings

1. **Hero preload="auto"** — highest-impact MP4 cost on LCP path.
2. **No max concurrent video policy** beyond singles row — hero + carousel + ambient can overlap.
3. **Ambient video uses blur(120px) filter** — decode + compositing cost doubled.
4. **Poster + video src** on singles — duplicate image fetch before video ready.

## Validation checklist

- [ ] HEAD request on hero MP4 — Content-Length, moov position (faststart?)
- [ ] iPhone 12/13: count `<video>` elements in DOM on Home
- [ ] CPU/GPU profile with 5 carousel videos + hero + playback
