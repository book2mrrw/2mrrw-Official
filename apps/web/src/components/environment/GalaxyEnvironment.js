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
 * the rest of the tree. Every per-frame value (star positions/twinkle,
 * lerp progress, parallax offset) lives in refs and is written straight to
 * the canvas / DOM style properties inside a single shared
 * requestAnimationFrame loop — never via setState. This mirrors the
 * ref+RAF / direct-DOM-write convention already established in this
 * codebase by GlobalAudioPlayerBar for its own frequently-updating values.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePointerCapability } from "@/hooks/usePointerCapability";
import { useReducedMotion } from "./use-reduced-motion";
import { resolveMood } from "./mood-table";
import { getTimeOfDayTarget } from "./time-of-day";
import { getPerformanceTier, TIER_PARAMS } from "./performance-tier";
import { createStarField, resizeStarField, stepStarField, drawStarField, lerp } from "./galaxy-engine";
import "./environment.css";

const TIME_CHECK_INTERVAL_MS = 60000;
const RESIZE_DEBOUNCE_MS = 150;
const LERP_FACTOR = 0.02;

const DEFAULT_TIME_TARGET = { phase: "night", starOpacity: 1, nebulaOpacity: 0.9, hueBias: 0, speedMultiplier: 1, moonOpacity: 0.85, sunOpacity: 0 };

export default function GalaxyEnvironment() {
  const pathname = usePathname();
  const pointerFine = usePointerCapability();
  const reducedMotion = useReducedMotion();

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
  const canvasRef = useRef(null);

  const starsRef = useRef([]);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(0);
  const elapsedRef = useRef(0);
  const currentStateRef = useRef({ starOpacity: 1, nebulaOpacity: 0.8, hueBias: 0, speedMultiplier: 1, moonOpacity: 0.8, sunOpacity: 0 });
  const targetStateRef = useRef({ starOpacity: 1, nebulaOpacity: 0.8, hueBias: 0, speedMultiplier: 1, moonOpacity: 0.8, sunOpacity: 0 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const scrollRef = useRef(0);
  const tierRef = useRef("medium");

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

  // Roughly every 30 minutes (with jitter so it never feels metronomic),
  // and only when it's night-ish (moon dominant) — a shooting star against
  // a bright daytime sky wouldn't read as anything. Gated here, not in CSS,
  // so a daytime tick just reschedules without ever rendering the element.
  useEffect(() => {
    if (reducedMotion) return undefined;
    let timeoutId;
    function schedule() {
      const delayMs = (25 + Math.random() * 10) * 60 * 1000;
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

    const targetCount = Math.round(TIER_PARAMS[computedTier].starCount * mood.starDensity);
    starsRef.current = starsRef.current.length
      ? resizeStarField(starsRef.current, targetCount)
      : createStarField(targetCount);
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

  // --- canvas sizing: updates in place on resize, never recreated ------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = viewport.width || (typeof window !== "undefined" ? window.innerWidth : 0);
    const height = viewport.height || (typeof window !== "undefined" ? window.innerHeight : 0);
    if (!width || !height) return;
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [viewport.width, viewport.height]);

  // --- pointer / scroll: passive listeners, refs only, never blocking --

  useEffect(() => {
    function onPointerMove(e) {
      if (!TIER_PARAMS[tierRef.current].pointerParallax) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      pointerRef.current.x = (e.clientX / w - 0.5) * 2;
      pointerRef.current.y = (e.clientY / h - 0.5) * 2;
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

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

    function applyNebulaStyles(state) {
      const root = rootRef.current;
      if (!root) return;
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

    function drawStatic() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        drawStarField(ctx, starsRef.current, {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          elapsedSeconds: 0,
          opacityMultiplier: targetStateRef.current.starOpacity,
          glow: TIER_PARAMS[tierRef.current].glow,
        });
      }
      applyNebulaStyles(targetStateRef.current);
    }

    function frame(ts) {
      if (cancelled) return;

      const tierParams = TIER_PARAMS[tierRef.current];
      if (!tierParams.animate) {
        drawStatic();
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

      stepStarField(starsRef.current, dt * cur.speedMultiplier);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        const parallaxX = tierParams.pointerParallax ? pointerRef.current.x * 6 : 0;
        const parallaxY = tierParams.pointerParallax ? pointerRef.current.y * 6 : 0;
        drawStarField(ctx, starsRef.current, {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          elapsedSeconds: elapsedRef.current,
          opacityMultiplier: cur.starOpacity,
          parallaxX,
          parallaxY,
          glow: tierParams.glow,
        });
      }

      applyNebulaStyles(cur);

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tier]);

  return (
    <div ref={rootRef} className="galaxy-environment" aria-hidden="true">
      <div className="galaxy-environment__nebula">
        <div className="galaxy-environment__orb galaxy-environment__orb--a" />
        <div className="galaxy-environment__orb galaxy-environment__orb--b" />
        <div className="galaxy-environment__orb galaxy-environment__orb--c" />
      </div>
      <div className="galaxy-environment__moon">
        <div className="galaxy-environment__moon-core" />
        <div className="galaxy-environment__moon-shadow" />
      </div>
      <div className="galaxy-environment__sun">
        <div className="galaxy-environment__sun-corona" />
        <div className="galaxy-environment__sun-core" />
      </div>
      {shootingStarKey > 0 && <div key={shootingStarKey} className="galaxy-environment__shooting-star" />}
      <canvas ref={canvasRef} className="galaxy-environment__canvas" />
    </div>
  );
}
