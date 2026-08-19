"use client";

// phase11: GiftRevealExperience is intentionally NOT on modalStackStore — fullscreen
// cinematic overlay with independent scroll/lock behavior (see Phase 11 Step 1).

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import CoverArt from "@/components/ui/CoverArt";
import { markGiftRevealSeen, scheduleGiftCollectionHandoff } from "@/lib/gifts/session-keys";

const PHASES = ["veil", "ambient", "artifact", "particles", "build", "burst", "erupt", "message", "dock"];

const PHASE_MS = {
  veil: 700,
  ambient: 900,
  artifact: 1100,
  particles: 1000,
  build: 1400,
  burst: 450,
  erupt: 900,
  message: 2200,
  dock: 1100,
};

const REDUCED_PHASE_MS = {
  veil: 120,
  ambient: 120,
  artifact: 200,
  particles: 0,
  build: 400,
  burst: 120,
  erupt: 350,
  message: 1400,
  dock: 600,
};

function ParticleField({ active, reduced }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: `${8 + ((i * 37) % 84)}%`,
        delay: `${(i % 7) * 0.12}s`,
        size: 2 + (i % 3),
        hue: i % 2 === 0 ? "#a259ff" : "#00ffff",
      })),
    []
  );
  if (reduced || !active) return null;
  return (
    <div className="gift-reveal-particles" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="gift-reveal-particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.hue,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}

export default function GiftRevealExperience({
  giftId,
  title,
  message,
  coverUrl,
  coverImageUrl,
  coverArtType,
  productSlug,
  onFinished,
}) {
  const reduced = useReducedMotion();
  const timings = reduced ? REDUCED_PHASE_MS : PHASE_MS;
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const phase = PHASES[phaseIndex] || "dock";
  const showArtwork = ["erupt", "message", "dock"].includes(phase);
  const showArtifact = ["artifact", "particles", "build", "burst"].includes(phase);
  const showTouch = phase === "build" && ready;

  useEffect(() => {
    if (phase !== "build") return undefined;
    const t = window.setTimeout(() => setReady(true), reduced ? 80 : 400);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  useEffect(() => {
    if (phaseIndex >= PHASES.length - 1) return undefined;
    // build phase waits indefinitely for the user's tap — no auto-advance
    if (phase === "build") return undefined;
    const ms = timings[phase] ?? 800;
    const timer = window.setTimeout(() => {
      setPhaseIndex((i) => Math.min(i + 1, PHASES.length - 1));
    }, ms);
    return () => clearTimeout(timer);
  }, [phaseIndex, phase, timings]);

  const advanceFromBuild = useCallback(() => {
    if (phase !== "build") return;
    setPhaseIndex((i) => (PHASES[i] === "build" ? i + 1 : i));
  }, [phase]);

  useEffect(() => {
    if (phase !== "dock") return undefined;
    markGiftRevealSeen(giftId);
    scheduleGiftCollectionHandoff({ slug: productSlug });
    const timer = window.setTimeout(() => {
      onFinished?.();
    }, timings.dock);
    return () => clearTimeout(timer);
  }, [phase, giftId, productSlug, onFinished, timings.dock]);

  return (
    <LayoutGroup id="gift-reveal">
    <div
      className={`gift-reveal-root gift-reveal-phase-${phase}${reduced ? " gift-reveal-reduced" : ""}`}
      role="dialog"
      aria-label="Gift reveal"
      aria-live="polite"
    >
      <div className="gift-reveal-veil" aria-hidden />
      <motion.div
        className="gift-reveal-ambient"
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === "veil" ? 0 : 1 }}
        transition={{ duration: reduced ? 0.15 : 0.9 }}
      />

      <ParticleField active={phase === "particles"} reduced={reduced} />

      {showArtifact ? (
        <motion.button
          layoutId="gift-reveal-core"
          type="button"
          className="gift-reveal-artifact"
          onClick={phase === "build" ? advanceFromBuild : undefined}
          aria-label={phase === "build" ? "Open gift" : undefined}
          initial={{ scale: 0.6, opacity: 0, y: 24 }}
          animate={{
            scale: phase === "burst" ? 1.35 : phase === "build" && ready ? 1.05 : 1,
            opacity: phase === "burst" ? 0 : 1,
            y: 0,
          }}
          transition={{ duration: reduced ? 0.2 : 0.65, ease: [0.22, 1, 0.36, 1] }}
        >
          {coverUrl && coverArtType === "video" ? (
            <video
              className="gift-reveal-artifact-cover"
              src={coverUrl}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              aria-hidden
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : coverImageUrl ? (
            <span
              className="gift-reveal-artifact-cover"
              style={{ backgroundImage: `url(${coverImageUrl})` }}
              aria-hidden
            />
          ) : null}
          <span className="gift-reveal-artifact-core" />
          {showTouch ? (
            <span className="gift-reveal-touch-hint">Touch to open</span>
          ) : null}
        </motion.button>
      ) : null}

      {phase === "burst" ? <div className="gift-reveal-burst-flash" aria-hidden /> : null}

      {showArtwork ? (
        <motion.div
          layoutId="gift-reveal-core"
          className="gift-reveal-artwork-wrap"
          initial={false}
          transition={{ duration: reduced ? 0.25 : 0.85, ease: [0.16, 1, 0.3, 1] }}
        >
          {coverUrl ? (
            <CoverArt
              src={coverUrl}
              type={coverArtType}
              alt=""
              width={280}
              className="gift-reveal-artwork"
            />
          ) : (
            <div className="gift-reveal-artwork gift-reveal-artwork-fallback" />
          )}
        </motion.div>
      ) : null}

      {["message", "dock"].includes(phase) ? (
        <motion.p
          className="gift-reveal-tagline"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.25, duration: 0.5 }}
        >
          You have just received a gift from <strong>2MRRW</strong>
          {title ? (
            <>
              <br />
              <span className="gift-reveal-tagline-title">{title}</span>
            </>
          ) : null}
          {message?.trim() ? (
            <span className="gift-reveal-tagline-message">&ldquo;{message.trim()}&rdquo;</span>
          ) : null}
        </motion.p>
      ) : null}

      {phase === "dock" ? (
        <motion.div
          className="gift-reveal-dock-trail"
          aria-hidden
          initial={{ scale: 1, opacity: 1, x: 0, y: 0 }}
          animate={{
            scale: 0.2,
            opacity: 0,
            x: reduced ? 0 : "42vw",
            y: reduced ? 0 : "38vh",
          }}
          transition={{ duration: reduced ? 0.35 : 0.95, ease: [0.4, 0, 0.2, 1] }}
        >
          <span className="gift-reveal-dock-orb" />
        </motion.div>
      ) : null}
    </div>
    </LayoutGroup>
  );
}
