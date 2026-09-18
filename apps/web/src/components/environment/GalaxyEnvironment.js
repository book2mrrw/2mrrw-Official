"use client";

/**
 * Persistent, adaptive galaxy/atmosphere background. Pure decoration —
 * mounted once at the application-shell level (see apps/web/src/app/layout.js)
 * and never remounted by route changes or in-app tab switches.
 *
 * Isolation: this file and everything it imports from ./ has zero
 * dependency on AudioContext, AudioEngineRuntime, AuthContext, any
 * playback/audio/video module, cart, or business logic. The only signals it
 * reads from the rest of the app arrive one-way, via `window` CustomEvents
 * ("2mrrw:tab-changed", "2mrrw:release-palette") that are no-ops if this
 * component isn't mounted — see the plan doc for the two matching
 * dispatch-side one-liners in HomeClient.js and ImmersivePreviewModal.js.
 *
 * Render loop discipline: only low-frequency context (route, tab, time-of-
 * day bucket, reduced-motion, viewport tier, release palette) is ever held
 * in React state — updating it re-renders only this isolated component, not
 * the rest of the tree. Every per-frame value (opacity/hue lerp progress,
 * scroll offset) lives in refs and is written straight to DOM style
 * properties (CSS custom properties consumed by the video/nebula layers)
 * inside a single shared requestAnimationFrame loop — never via setState.
 * This mirrors the ref+RAF / direct-DOM-write convention already
 * established in this codebase by GlobalAudioPlayerBar for its own
 * frequently-updating values.
 *
 * Layers (star-background/galaxy/sun/shooting-star) are real <video>/<img>
 * elements playing user-supplied footage. None of the five <video> elements
 * below carry a native `autoPlay` attribute -- all five are registered with
 * VideoResourceManager (VRM) at mount and play only once VRM grants them,
 * via VRM's own onGranted/onRevoked callbacks (see the "VRM" effects below).
 * This is what actually fixed a live iOS regression: with plain `autoPlay`
 * on all of them, iOS's real, low, fixed concurrent-decode ceiling meant some
 * of them (galaxy, earth) silently never started, leaving their canvases
 * permanently blank. VRM staggers grants on iOS so that never happens
 * again, and the same protection now covers every other video-bearing
 * surface in the app, not just this component (see
 * video-resource-manager.js's header comment). Sun's `opacity`
 * and `mix-blend-mode: screen` live on the SAME CSS rule (see
 * environment.css) — splitting them across an ancestor/child pair breaks
 * the blend-mode (an ancestor's opacity<1 isolates a descendant's blend
 * mode from the real page behind it), which bit this exact setup before
 * landing on this pattern.
 *
 * Moon, earth and galaxy are a further exception: they need to show only
 * their actual silhouette (a real object, or in the galaxy's case a nebula
 * with soft, irregular glowing edges) with genuinely transparent
 * surroundings — not a geometric shape, not a CSS clip, not a blend-mode
 * approximation. An earlier pass tried cutting a circular alpha hole via
 * Canvas destination-in — that was wrong: it clipped the canvas's own
 * frame into a circle, but never touched the video content's own
 * background margin *inside* that circle, so a visible dark/gray disk
 * remained (the actual bug the user's screenshot caught). CSS clipping
 * (border-radius, overflow:hidden, clip-path, mask-image) was ruled out
 * earlier for a different reason: <video> elements can get promoted to
 * their own hardware compositing layer that bypasses normal CSS clipping
 * in some browsers. And no video codec's own alpha channel survives in
 * real WebKit — verified directly this round (a VP9-alpha WebM played in
 * real Playwright/WebKit and sampled via canvas came back alpha=255
 * everywhere, i.e. silently flattened to opaque).
 *
 * The fix operates on the ASSETS, not the container, but how differs by
 * object. The galaxy's nebula has no fixed geometry, so it's matted with
 * flood-fill (from the frame border, following the real gradual falloff
 * already in the footage rather than imposing a shape, protecting the
 * black hole's own dark core from being punched transparent by a naive
 * brightness key). Moon and earth ARE fixed geometry — real spheres — and
 * flood-fill matting fought that: a sphere's own unlit side is genuinely
 * near-black and blends into black space with literally no detectable edge
 * there, so per-pixel classification landed inconsistently frame to frame
 * (a visible staircase along the terminator) and sometimes ate real dark
 * surface detail outright (mistaking it for background). The fix: measure
 * the sphere's true (cx, cy, radius) once from the footage's reliably-
 * detectable LIT portion (stable across a locked-off shot) and fill that
 * whole real disk — lit or naturally dark — as one circle, the shape a
 * sphere actually has, instead of an artifact of where a brightness/texture
 * decision happened to land. The unlit portion's opacity still scales with
 * how much of the disk is actually lit that frame (a thin crescent fades
 * its dark side toward transparent instead of dragging along one big solid
 * black disk; once enough is lit it reads as a complete sphere) — a
 * continuous function of the frame's own real lit fraction, not a
 * synthetic shape choice.
 *
 * Whichever matting path produced it, each source video's real per-pixel
 * alpha channel is packed into a single ordinary H.264 video:
 * each frame stacks the real color on top and the alpha mask (as
 * grayscale) on the bottom, same width, double height. A first version
 * used two SEPARATE videos (color + alpha) combined in JS — technically
 * correct in a single still frame, but visibly flickered during real
 * playback: two independent <video> elements have no guaranteed frame
 * lock, so color and alpha could momentarily show different points in the
 * sequence. Packing them into one video file makes that impossible —
 * there's physically only one stream to decode, so color and alpha are
 * always the exact same decoded frame. No experimental codec alpha
 * feature involved either way — this is ordinary, hardware-decoded video.
 *
 * Each frame, the hidden decode-source video's top half (color) is drawn
 * straight onto the visible canvas and its bottom half (alpha) is drawn to
 * a scratch canvas; the scratch's luminance is then copied into the
 * canvas image's alpha channel before it's painted — genuine per-pixel
 * transparency that follows the real object silhouette, computed from
 * real matted asset data, not a synthetic mask shape. This is throttled to
 * ~15fps (matching the source encode) inside the SAME shared RAF loop as
 * everything else below — no new render loop, no setState.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePointerCapability } from "@/hooks/usePointerCapability";
import { usePlatform } from "@/hooks/usePlatform";
import { VRM } from "@/lib/media/video-resource-manager";
import { useReducedMotion } from "./use-reduced-motion";
import { resolveMood } from "./mood-table";
import { getTimeOfDayTarget } from "./time-of-day";
import { getPerformanceTier, TIER_PARAMS } from "./performance-tier";
import { lerp } from "./galaxy-engine";
import "./environment.css";

const TIME_CHECK_INTERVAL_MS = 60000;
const RESIZE_DEBOUNCE_MS = 150;
const LERP_FACTOR = 0.02;

const DEFAULT_TIME_TARGET = { phase: "night", starOpacity: 1, nebulaOpacity: 0.9, hueBias: 0, speedMultiplier: 1, moonOpacity: 0.85, sunOpacity: 0 };

export default function GalaxyEnvironment() {
  const pathname = usePathname();
  const pointerFine = usePointerCapability();
  const reducedMotion = useReducedMotion();
  const platform = usePlatform();

  const [tabId, setTabId] = useState("home");
  const [timeTarget, setTimeTarget] = useState(DEFAULT_TIME_TARGET);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [releasePalette, setReleasePalette] = useState(null);
  // Real state (not just a ref) so the RAF-loop effect below can depend on
  // it and correctly restart the loop if the tier changes away from "low"
  // (e.g. reduced-motion toggled off, or a foldable unfolds past the
  // immersive threshold) — a ref alone would leave the loop permanently
  // stopped once it self-stopped for a static low-tier paint.
  const [tier, setTier] = useState("medium");
  // 0 = none shown yet. Bumping this remounts the shooting-star element
  // (via key), which is the simplest reliable way to restart its CSS
  // animation on each trigger without any manual class/timing juggling.
  const [shootingStarKey, setShootingStarKey] = useState(0);

  const rootRef = useRef(null);
  const starBackgroundVideoRef = useRef(null);
  const sunVideoRef = useRef(null);
  const moonVideoRef = useRef(null);
  const moonCanvasRef = useRef(null);
  const moonActiveRef = useRef(false);
  const earthVideoRef = useRef(null);
  const earthCanvasRef = useRef(null);
  const earthActiveRef = useRef(false);
  const galaxyVideoRef = useRef(null);
  const galaxyCanvasRef = useRef(null);
  const galaxyActiveRef = useRef(false);
  // Scratch canvas used to decode each object's alpha-mask video frame long
  // enough to read its pixels -- reused across all three objects since the
  // RAF loop draws them one at a time, never concurrently. Never attached
  // to the DOM.
  const scratchCanvasRef = useRef(null);
  const lastCombineRef = useRef(0);
  const combineRoundRobinRef = useRef(0);

  const rafRef = useRef(null);
  const lastFrameRef = useRef(0);
  const elapsedRef = useRef(0);
  const currentStateRef = useRef({ starOpacity: 1, nebulaOpacity: 0.8, hueBias: 0, speedMultiplier: 1, moonOpacity: 0.8, sunOpacity: 0 });
  const targetStateRef = useRef({ starOpacity: 1, nebulaOpacity: 0.8, hueBias: 0, speedMultiplier: 1, moonOpacity: 0.8, sunOpacity: 0 });
  const scrollRef = useRef(0);
  const tierRef = useRef("medium");

  // --- VRM: register every video once on mount --------------------------
  // No <video> below carries autoPlay; VRM's onGranted/onRevoked (wired in
  // the next effect) are the only things that ever call .play()/.pause()
  // on them. PRIORITY_DECORATIVE is the lowest tier -- if the shared
  // budget is ever under real pressure, this purely-decorative background
  // is the first thing evicted, before Vault/Ambient/CoverArt.
  useEffect(() => {
    const videos = [
      starBackgroundVideoRef.current,
      sunVideoRef.current,
      moonVideoRef.current,
      earthVideoRef.current,
      galaxyVideoRef.current,
    ];
    videos.forEach((video) => {
      if (video) VRM.register(video, VRM.PRIORITY_DECORATIVE);
    });
    return () => {
      videos.forEach((video) => {
        if (!video) return;
        video.pause();
        VRM.unregister(video);
      });
    };
  }, []);

  // --- VRM: request/release play based on reduced-motion + tab visibility
  // This is where the actual .play()/.pause() calls happen, only ever from
  // VRM's onGranted/onRevoked. On iOS, VRM staggers grants when several
  // land in the same pass instead of firing them all synchronously (see
  // video-resource-manager.js) -- this is what fixed galaxy/earth never
  // appearing on iPhone. onGranted/onRevoked for the 4 canvas-fed videos
  // also flips an "active" ref that gates their combinePacked() calls
  // below: revoked means paused + the canvas just keeps its last painted
  // frame (graceful freeze under real memory pressure), not blank.
  useEffect(() => {
    const canvasFed = [
      { video: moonVideoRef.current, activeRef: moonActiveRef },
      { video: earthVideoRef.current, activeRef: earthActiveRef },
      { video: galaxyVideoRef.current, activeRef: galaxyActiveRef },
    ];
    const direct = [starBackgroundVideoRef.current, sunVideoRef.current];

    function requestAll() {
      canvasFed.forEach(({ video, activeRef }) => {
        if (!video) return;
        VRM.requestPlay(
          video,
          () => { activeRef.current = true; video.play()?.catch(() => { /* gesture/policy rejection, not fatal */ }); },
          () => { activeRef.current = false; video.pause(); }
        );
      });
      direct.forEach((video) => {
        if (!video) return;
        VRM.requestPlay(
          video,
          () => { video.play()?.catch(() => { /* gesture/policy rejection, not fatal */ }); },
          () => video.pause()
        );
      });
    }

    function releaseAll() {
      canvasFed.forEach(({ video, activeRef }) => {
        if (!video) return;
        VRM.requestPause(video);
        video.pause();
        activeRef.current = false;
      });
      direct.forEach((video) => {
        if (!video) return;
        VRM.requestPause(video);
        video.pause();
      });
    }

    if (reducedMotion) {
      releaseAll();
      return undefined;
    }

    if (!document.hidden) requestAll();

    function handleVisibility() {
      if (document.hidden) releaseAll();
      else requestAll();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      releaseAll();
    };
  }, [reducedMotion]);

  // --- low-frequency signal wiring: tab, palette, clock, viewport -----

  useEffect(() => {
    function handleTabChanged(e) {
      const id = e?.detail?.tabId;
      if (id) setTabId(id);
    }
    window.addEventListener("2mrrw:tab-changed", handleTabChanged);
    return () => window.removeEventListener("2mrrw:tab-changed", handleTabChanged);
  }, []);

  useEffect(() => {
    function handlePalette(e) {
      setReleasePalette(e?.detail || null);
    }
    window.addEventListener("2mrrw:release-palette", handlePalette);
    return () => window.removeEventListener("2mrrw:release-palette", handlePalette);
  }, []);

  useEffect(() => {
    // Real Date() only ever runs client-side (never during SSR of this
    // client component), so time-of-day never depends on server clock/TZ.
    setTimeTarget(getTimeOfDayTarget());
    const id = setInterval(() => setTimeTarget(getTimeOfDayTarget()), TIME_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Roughly every 3 minutes (with jitter so it never feels metronomic),
  // and only when it's night-ish (moon dominant) — a shooting star against
  // a bright daytime sky wouldn't read as anything. Gated here, not in CSS,
  // so a daytime tick just reschedules without ever rendering the element.
  useEffect(() => {
    if (reducedMotion) return undefined;
    let timeoutId;
    function schedule() {
      const delayMs = (2.5 + Math.random() * 1) * 60 * 1000;
      timeoutId = setTimeout(() => {
        if (targetStateRef.current.moonOpacity > 0.5) {
          setShootingStarKey((k) => k + 1);
        }
        schedule();
      }, delayMs);
    }
    schedule();
    return () => clearTimeout(timeoutId);
  }, [reducedMotion]);

  useEffect(() => {
    function updateViewport() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    updateViewport();
    let resizeTimer = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateViewport, RESIZE_DEBOUNCE_MS);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, []);

  // --- derive target visual state + star pool from the signals above --

  useEffect(() => {
    const mood = resolveMood({ pathname, tabId });
    const computedTier = getPerformanceTier({ reducedMotion, pointerFine, width: viewport.width, height: viewport.height });
    tierRef.current = computedTier;
    setTier(computedTier); // bails out automatically if unchanged — cheap

    targetStateRef.current = {
      starOpacity: timeTarget.starOpacity,
      nebulaOpacity: timeTarget.nebulaOpacity * mood.nebulaIntensity,
      hueBias: mood.hueBias + timeTarget.hueBias + (releasePalette ? 6 : 0),
      speedMultiplier: timeTarget.speedMultiplier * mood.speed,
      moonOpacity: timeTarget.moonOpacity,
      sunOpacity: timeTarget.sunOpacity,
    };
  }, [pathname, tabId, reducedMotion, pointerFine, viewport.width, viewport.height, timeTarget, releasePalette]);

  // --- release-modal artwork palette -> nebula tint (occasional, not per-frame) --

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (releasePalette?.p1) root.style.setProperty("--galaxy-p1", releasePalette.p1);
    else root.style.removeProperty("--galaxy-p1");
    if (releasePalette?.accent) root.style.setProperty("--galaxy-p2", releasePalette.accent);
    else root.style.removeProperty("--galaxy-p2");
    if (releasePalette?.glow) root.style.setProperty("--galaxy-p3", releasePalette.glow);
    else root.style.removeProperty("--galaxy-p3");
  }, [releasePalette]);

  // --- scroll: passive listener, ref only, never blocking --------------

  useEffect(() => {
    function onScroll() {
      if (!TIER_PARAMS[tierRef.current].scrollParallax) return;
      scrollRef.current = window.scrollY || 0;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // --- the one shared animation loop — refs/canvas/DOM writes only, -----
  // --- never setState per frame. Depends only on `tier` (a low-frequency
  // value that changes at most a few times per session) so it restarts
  // cleanly if the tier moves away from "low" after self-stopping for a
  // static paint — every value read per-frame still comes from refs. -----

  useEffect(() => {
    let cancelled = false;

    // Draws the top half of `video`'s current frame (real color) to
    // `canvas`, then replaces its alpha channel with the bottom half's
    // luminance (the matted alpha mask, stacked into the same file at
    // encode time) -- genuine per-pixel transparency read from a real,
    // content-matted asset, not a shape computed at render time. A single
    // packed video (not two separate color/alpha videos) guarantees color
    // and alpha are always the same decoded frame -- see the header
    // comment for why that matters (two independent <video> elements
    // visibly flickered when their decode timing drifted). readyState < 2
    // means the video has no decoded frame yet -- skip rather than draw a
    // blank/stale one.
    function combinePacked(canvas, video) {
      if (!canvas || !video || video.readyState < 2) return;
      const scratch = scratchCanvasRef.current;
      if (!scratch) return;
      const ctx = canvas.getContext("2d");
      const scratchCtx = scratch.getContext("2d");
      if (!ctx || !scratchCtx) return;
      const w = canvas.width;
      const h = canvas.height;
      const vw = video.videoWidth;
      const vh = video.videoHeight / 2; // top half color, bottom half alpha
      if (!vw || !vh) return;

      ctx.drawImage(video, 0, 0, vw, vh, 0, 0, w, h);
      const rgbData = ctx.getImageData(0, 0, w, h);

      scratch.width = w;
      scratch.height = h;
      scratchCtx.drawImage(video, 0, vh, vw, vh, 0, 0, w, h);
      const alphaData = scratchCtx.getImageData(0, 0, w, h);

      const rgbPixels = rgbData.data;
      const alphaPixels = alphaData.data;
      // The packed alpha mask never decodes as a true 0..255. Measured in a
      // real browser: background floors at 14-33 (not 0) and an object's own
      // disk tops out at 196-237 (not 255) -- limited/TV-range H.264 signalling,
      // plus, on the moon, its own lit/unlit alpha split (196 vs 223). Copied
      // straight across, that left every "solid" object only 77-93% opaque,
      // which is why the star-background layer visibly showed through the moon.
      // Normalising 40..190 to a full 0..255 clamps background to truly
      // invisible and the disk to truly opaque; the narrow band between still
      // carries the anti-aliased rim, so edges stay smooth.
      for (let i = 0; i < rgbPixels.length; i += 4) {
        const a = (alphaPixels[i] - 40) * 255 / 150;
        rgbPixels[i + 3] = a < 0 ? 0 : a > 255 ? 255 : a;
      }
      ctx.putImageData(rgbData, 0, 0);
    }

    // `respectActive`: gate each object on VRM's onGranted/onRevoked
    // ("active") flag instead of always drawing -- used by the continuous
    // per-frame path below so a revoked object's canvas just keeps its
    // last painted frame (graceful freeze) instead of burning decode/CPU
    // work on a video VRM has asked to pause. The one-time static paint
    // (reduced-motion/low-tier) always draws regardless, matching prior
    // behavior -- combinePacked's own readyState check already prevents it
    // from drawing anything before the video has decoded a first frame.
    // `roundRobin`: on iOS, recombine only one object per call (cycling
    // through in turn) instead of all four, halving peak per-frame
    // getImageData/putImageData cost -- iOS Safari enforces a stricter
    // per-frame budget than desktop/Android, where all four still update
    // every call.
    function drawCelestialBodies({ respectActive = false, roundRobin = false } = {}) {
      const objects = [
        { active: moonActiveRef.current, draw: () => combinePacked(moonCanvasRef.current, moonVideoRef.current) },
        { active: earthActiveRef.current, draw: () => combinePacked(earthCanvasRef.current, earthVideoRef.current) },
        { active: galaxyActiveRef.current, draw: () => combinePacked(galaxyCanvasRef.current, galaxyVideoRef.current) },
      ];
      if (roundRobin) {
        const obj = objects[combineRoundRobinRef.current % objects.length];
        combineRoundRobinRef.current += 1;
        if (!respectActive || obj.active) obj.draw();
        return;
      }
      objects.forEach((obj) => {
        if (!respectActive || obj.active) obj.draw();
      });
    }

    function applyNebulaStyles(state) {
      const root = rootRef.current;
      if (!root) return;
      root.style.setProperty("--galaxy-star-opacity", state.starOpacity.toFixed(3));
      root.style.setProperty("--galaxy-nebula-opacity", state.nebulaOpacity.toFixed(3));
      root.style.setProperty("--galaxy-hue-bias", `${state.hueBias.toFixed(1)}deg`);
      root.style.setProperty("--galaxy-moon-opacity", state.moonOpacity.toFixed(3));
      root.style.setProperty("--galaxy-sun-opacity", state.sunOpacity.toFixed(3));
      const scrollOffset = tierRef.current === "low" ? 0 : scrollRef.current * 0.02;
      root.style.setProperty("--galaxy-scroll-offset", `${scrollOffset.toFixed(1)}px`);
      // Moves slower than the nebula — a further-away layer, for depth.
      const moonScrollOffset = tierRef.current === "low" ? 0 : scrollRef.current * 0.008;
      root.style.setProperty("--galaxy-moon-scroll-offset", `${moonScrollOffset.toFixed(1)}px`);
    }

    // The combine sources are encoded at up to 30fps (earth) -- recombining
    // faster than that on every RAF tick (which can run well past 60fps)
    // would just burn CPU on getImageData/putImageData for pixel data
    // that hasn't changed. Matches the fastest source so no asset is ever
    // bottlenecked below its own encoded rate. Throttled independently of
    // the nebula/opacity lerps above, which stay smooth every frame. iOS
    // gets a slower rate (paired with the round-robin single-object update
    // below) since its stricter per-frame budget makes the full-rate,
    // all-objects-every-tick cost that Android/desktop absorbs comfortably
    // relatively more expensive there.
    const COMBINE_INTERVAL_MS = platform.isIOS ? 1000 / 15 : 1000 / 30;

    function frame(ts) {
      if (cancelled) return;

      const tierParams = TIER_PARAMS[tierRef.current];
      if (!tierParams.animate) {
        applyNebulaStyles(targetStateRef.current);
        drawCelestialBodies(); // one static paint, matches poster-frame behavior
        return; // low tier / reduced motion: one paint, no further frames
      }

      if (!lastFrameRef.current) lastFrameRef.current = ts;
      const dt = Math.min((ts - lastFrameRef.current) / 1000, 0.1); // clamp for tab-resume jumps
      lastFrameRef.current = ts;
      elapsedRef.current += dt;

      const cur = currentStateRef.current;
      const tgt = targetStateRef.current;
      cur.starOpacity = lerp(cur.starOpacity, tgt.starOpacity, LERP_FACTOR);
      cur.nebulaOpacity = lerp(cur.nebulaOpacity, tgt.nebulaOpacity, LERP_FACTOR);
      cur.hueBias = lerp(cur.hueBias, tgt.hueBias, LERP_FACTOR);
      cur.speedMultiplier = lerp(cur.speedMultiplier, tgt.speedMultiplier, LERP_FACTOR);
      cur.moonOpacity = lerp(cur.moonOpacity, tgt.moonOpacity, LERP_FACTOR);
      cur.sunOpacity = lerp(cur.sunOpacity, tgt.sunOpacity, LERP_FACTOR);

      applyNebulaStyles(cur);
      if (ts - lastCombineRef.current >= COMBINE_INTERVAL_MS) {
        lastCombineRef.current = ts;
        drawCelestialBodies({ respectActive: true, roundRobin: platform.isIOS });
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement("canvas");
    }

    rafRef.current = requestAnimationFrame(frame);

    // Static low-tier/reduced-motion paint only draws once, at whatever
    // instant that first frame() call happens to land -- if a hidden
    // decode-source video hasn't reached readyState 2 yet by then (still
    // loading), combinePacked's guard skips it and, with no further
    // frames coming, that canvas would stay blank forever. "loadeddata"
    // fires once a video's first frame is actually decoded, so catch up
    // with one more paint then. Harmless to attach unconditionally (cheap,
    // idempotent, and the normal per-frame branch is already redrawing
    // regularly anyway).
    const videoEls = [moonVideoRef.current, earthVideoRef.current, galaxyVideoRef.current];
    function handleAnySourceReady() {
      drawCelestialBodies();
    }
    videoEls.forEach((el) => el?.addEventListener("loadeddata", handleAnySourceReady));

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      videoEls.forEach((el) => el?.removeEventListener("loadeddata", handleAnySourceReady));
    };
  }, [tier, platform.isIOS]);

  return (
    <div ref={rootRef} className="galaxy-environment" aria-hidden="true">
      <video
        ref={starBackgroundVideoRef}
        className="galaxy-environment__star-background"
        src="/environment/star-background.mp4"
        poster="/environment/star-background-poster.png"
        loop={!reducedMotion}
        muted
        playsInline
        preload="auto"
      />
      <div className="galaxy-environment__galaxy">
        {/* Hidden decode source, never shown directly -- a single packed
            video (real color on top, real alpha mask on the bottom half,
            matted offline from the actual footage -- see the header
            comment) combined onto the visible canvas below every frame. */}
        <video
          ref={galaxyVideoRef}
          className="galaxy-environment__celestial-source"
          src="/environment/galaxy-packed.mp4"
          loop={!reducedMotion}
          muted
          playsInline
          preload="auto"
        />
        <canvas
          ref={galaxyCanvasRef}
          className="galaxy-environment__galaxy-core"
          width={640}
          height={360}
        />
      </div>
      <div className="galaxy-environment__nebula">
        <div className="galaxy-environment__orb galaxy-environment__orb--b" />
        <div className="galaxy-environment__orb galaxy-environment__orb--c" />
      </div>
      <div className="galaxy-environment__moon">
        {/* Hidden decode source, never displayed directly -- the canvas
            below combines this single packed video's color + alpha-mask
            halves (see the header comment for why one packed video, not
            two separate ones). */}
        <video
          ref={moonVideoRef}
          className="galaxy-environment__celestial-source"
          src="/environment/moon-packed.mp4"
          // Trimmed to end exactly on the full moon, deliberately not
          // looping -- a real <video> without loop just holds on its last
          // decoded frame once it ends, so this settles on the full moon
          // and stays there rather than cycling back through the phases.
          loop={false}
          muted
          playsInline
          preload="auto"
        />
        <canvas
          ref={moonCanvasRef}
          className="galaxy-environment__moon-core"
          width={480}
          height={480}
        />
      </div>
      <div className="galaxy-environment__sun">
        <div className="galaxy-environment__sun-corona" />
        <video
          ref={sunVideoRef}
          className="galaxy-environment__sun-core"
          src="/environment/sun.mp4"
          poster="/environment/sun-poster.png"
          loop={!reducedMotion}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
      </div>
      <div className="galaxy-environment__earth">
        <video
          ref={earthVideoRef}
          className="galaxy-environment__celestial-source"
          src="/environment/earth-packed.mp4"
          loop={!reducedMotion}
          muted
          playsInline
          preload="auto"
        />
        <canvas
          ref={earthCanvasRef}
          className="galaxy-environment__earth-video"
          width={480}
          height={480}
        />
      </div>
      {shootingStarKey > 0 && (
        // Animated WebP with a real alpha channel (converted from the raw
        // footage: alpha = brightness above a threshold, so only the bright
        // streak itself survives -- the source's own Milky Way backdrop is
        // dropped entirely, "completely separate from its original
        // background" per explicit feedback). <img>, not <video>: WebP
        // animation autoplays/loops natively via <img>, and real alpha
        // composites correctly with normal img rendering -- no
        // mix-blend-mode needed, sidestepping that whole class of bug.
        <img
          key={shootingStarKey}
          className="galaxy-environment__shooting-star"
          src="/environment/shootingstar.webp"
          alt=""
          aria-hidden="true"
        />
      )}
    </div>
  );
}
