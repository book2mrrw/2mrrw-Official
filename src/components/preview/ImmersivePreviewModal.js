"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { useMediaEngine } from "@/media/useMediaEngine";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import { getReleaseEditorial, getCreditsDisplayRows } from "@/components/preview/releaseMetadata";
import { usePlayerBodyState } from "@/lib/player/usePlayerBodyState";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";

const PREVIEW_CAP_SEC = 30;

const fmt = (s) => {
  if (!s || Number.isNaN(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

function parseDurSec(track) {
  if (track?.durSec && Number.isFinite(track.durSec)) return track.durSec;
  const raw = track?.dur || track?.duration;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parts = raw.split(":").map(Number);
    if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) return parts[0] * 60 + parts[1];
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  return 0;
}

function trackCoverSrc(track) {
  const { src } = catalogCoverDisplay(track || {});
  return src || track?.coverArt || track?.cover || track?.coverUrl || "";
}

function buildTheme(palette) {
  const safe = palette && typeof palette === "object" ? palette : {};
  const p1 = safe.primaryCss || "#9b5de5";
  const accent = safe.secondaryCss || "#c77dff";
  const glow = safe.primaryGlow || "rgba(155,93,229,.6)";
  const glowDim = safe.primaryMuted || safe.primaryGlowDim || "rgba(155,93,229,.2)";
  return {
    dark: "#0a0a0a",
    p1,
    accent,
    glow,
    glowDim,
    bg: ["#0a0a0a", "#111", "#0a0a0a"],
    orb1: `radial-gradient(circle,${safe.gradientTop || glow},transparent 70%)`,
    orb2: `radial-gradient(circle,${safe.gradientBottom || glowDim},transparent 70%)`,
    orb3: `radial-gradient(circle,${safe.ambientTint || glowDim},transparent 70%)`,
  };
}

function themeVars(t) {
  return {
    "--glow": t.glow,
    "--glow-dim": t.glowDim,
    "--p1": t.p1,
    "--p1-dim": `${t.p1}55`,
    "--p1-dim2": `${t.p1}22`,
    "--accent": t.accent,
  };
}

const I = {
  Play: () => (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <polygon points="6,3 18,11 6,19" fill="currentColor" />
    </svg>
  ),
  Pause: () => (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="4" y="3" width="5" height="16" rx="2" fill="currentColor" />
      <rect x="13" y="3" width="5" height="16" rx="2" fill="currentColor" />
    </svg>
  ),
  Prev: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <polygon points="14,3 4,9 14,15" fill="currentColor" />
      <rect x="2" y="3" width="3" height="12" rx="1" fill="currentColor" />
    </svg>
  ),
  Next: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <polygon points="4,3 14,9 4,15" fill="currentColor" />
      <rect x="13" y="3" width="3" height="12" rx="1" fill="currentColor" />
    </svg>
  ),
  Shuffle: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 4h3l7 8h2" />
      <path d="M12 2l2 2-2 2" />
      <path d="M12 10l2 2-2 2" />
      <path d="M9 6l-2-2H2" />
    </svg>
  ),
  Repeat: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10v3l3-3-3-3v3" />
      <path d="M13 12H3V9l-3 3 3 3v-3" />
    </svg>
  ),
  Cart: ({ s = 32 }) => (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h3l4 14h12l3-9H9" />
      <circle cx="13" cy="24" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="22" cy="24" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  Sub: ({ s = 28 }) => (
    <svg width={s} height={s} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="14" cy="14" r="10" />
      <path d="M14 9v5l3 3" />
      <path d="M14 4v2M14 22v2M4 14h2M22 14h2" />
    </svg>
  ),
  Coll: ({ s = 28 }) => (
    <svg width={s} height={s} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4h12a2 2 0 012 2v16l-8-4-8 4V6a2 2 0 012-2z" fill="currentColor" fillOpacity=".15" />
      <path d="M8 4h12a2 2 0 012 2v16l-8-4-8 4V6a2 2 0 012-2z" />
    </svg>
  ),
  Plus: ({ s = 26 }) => (
    <svg width={s} height={s} viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="13" y1="4" x2="13" y2="22" />
      <line x1="4" y1="13" x2="22" y2="13" />
    </svg>
  ),
  TrPlay: () => (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none">
      <polygon points="1,.5 8.5,5 1,9.5" fill="currentColor" />
    </svg>
  ),
  TrPause: () => (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none">
      <rect x="0" y="0" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="6" y="0" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  ),
};

function useBeat(playing) {
  const [beat, setBeat] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!playing) return undefined;
    const fire = () => {
      setBeat(true);
      ref.current = setTimeout(() => {
        setBeat(false);
        ref.current = setTimeout(fire, 380 + Math.random() * 120);
      }, 110);
    };
    ref.current = setTimeout(fire, 400);
    return () => clearTimeout(ref.current);
  }, [playing]);
  return beat;
}

function useModalAnim() {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, []);
  return { mounted, closing, setClosing };
}

function Scene({ coverUrl, t }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!coverUrl) {
      setLoaded(false);
      return undefined;
    }
    setLoaded(false);
    const img = new Image();
    img.src = coverUrl;
    img.onload = () => setLoaded(true);
    img.onerror = () => setLoaded(false);
    return undefined;
  }, [coverUrl]);

  return (
    <div className="sc" style={{ background: `linear-gradient(160deg,${t.bg[0]},${t.bg[1]},${t.bg[2]})` }}>
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: loaded ? 0.42 : 0,
            transition: "opacity .7s ease",
          }}
        />
      ) : null}
      <div className="sc-orb orb-a" style={{ background: t.orb1 }} />
      <div className="sc-orb orb-b" style={{ background: t.orb2 }} />
      <div className="sc-orb orb-c" style={{ background: t.orb3 }} />
      <div className="sc-rays">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="sc-ray"
            style={{ background: `linear-gradient(to bottom,transparent,${t.accent}38,transparent)` }}
          />
        ))}
      </div>
      <div className="sc-scan" />
      <div className="sc-grain" />
    </div>
  );
}

function Waveform({ playing, t, bars = 26 }) {
  const [sc, setSc] = useState(() => Array(bars).fill(0.15));
  const ref = useRef(null);
  useEffect(() => {
    if (!playing) {
      setSc(Array(bars).fill(0.15));
      return undefined;
    }
    const tick = () => {
      setSc(
        Array(bars)
          .fill(0)
          .map((_, i) => {
            const c = bars / 2;
            const d = Math.abs(i - c) / c;
            return Math.max(0.1, Math.min(1, Math.random() * (1 - d * 0.4) + 0.1));
          })
      );
      ref.current = setTimeout(tick, 70 + Math.random() * 55);
    };
    tick();
    return () => clearTimeout(ref.current);
  }, [playing, bars]);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 18, justifyContent: "center", marginBottom: 8 }}>
      {sc.map((s, i) => (
        <div
          key={i}
          style={{
            width: 3,
            borderRadius: 2,
            height: 18,
            transformOrigin: "bottom",
            transform: `scaleY(${s})`,
            background: `linear-gradient(to top,${t.p1},${t.accent})`,
            transition: "transform .08s ease",
          }}
        />
      ))}
    </div>
  );
}

function ScrubBar({ pct, t, onSeekRatio, isPreview }) {
  const barRef = useRef(null);
  const handle = (e) => {
    const rect = (barRef.current || e.currentTarget).getBoundingClientRect();
    const cx = e.touches?.[0]?.clientX ?? e.clientX;
    onSeekRatio(Math.max(0, Math.min(1, (cx - rect.left) / rect.width)));
  };
  return (
    <div
      ref={barRef}
      onClick={handle}
      onTouchStart={handle}
      role="slider"
      aria-valuenow={pct}
      style={{
        width: "100%",
        height: 4,
        background: "rgba(255,255,255,.12)",
        borderRadius: 4,
        cursor: "pointer",
        position: "relative",
        flexShrink: 0,
      }}
    >
      {isPreview ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "30%",
            borderRight: `1px dashed ${t.p1}60`,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <div
        style={{
          width: `${Math.min(100, pct)}%`,
          height: "100%",
          borderRadius: 4,
          background: `linear-gradient(90deg,${t.p1},${t.accent})`,
          boxShadow: `0 0 8px ${t.glow}`,
          transition: "width .1s linear",
          position: "relative",
        }}
      >
        {pct > 2 ? (
          <div
            style={{
              position: "absolute",
              right: -6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: t.accent,
              boxShadow: `0 0 8px ${t.glow}`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function FloatingPlayer({ t, playing, current, duration, isPreview, beat, onPlay, onSeekRatio }) {
  const pct = duration ? (current / duration) * 100 : 0;
  const vars = themeVars(t);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        padding: "10px 20px 16px",
        background: "linear-gradient(to top,rgba(0,0,0,.92) 0%,rgba(0,0,0,.55) 60%,transparent 100%)",
        ...vars,
      }}
    >
      <Waveform playing={playing} t={t} bars={26} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span
          style={{
            fontFamily: "'DM Mono',monospace",
            fontSize: 10,
            color: "rgba(255,255,255,.38)",
            flexShrink: 0,
            minWidth: 28,
          }}
        >
          {fmt(current)}
        </span>
        <ScrubBar pct={pct} t={t} onSeekRatio={onSeekRatio} isPreview={isPreview} />
        <span
          style={{
            fontFamily: "'DM Mono',monospace",
            fontSize: 10,
            color: "rgba(255,255,255,.38)",
            flexShrink: 0,
            minWidth: 28,
            textAlign: "right",
          }}
        >
          {isPreview ? "0:30" : fmt(duration)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", ...vars }}>
        <button type="button" className={`c-sm${beat ? " beat" : ""}`} aria-hidden>
          <I.Shuffle />
        </button>
        <button type="button" className={`c-md${beat ? " beat" : ""}`} aria-hidden>
          <I.Prev />
        </button>
        <button type="button" className={`c-lg${playing ? " playing" : ""}${beat ? " beat" : ""}`} onClick={onPlay} style={vars}>
          {playing ? <I.Pause /> : <I.Play />}
        </button>
        <button type="button" className={`c-md${beat ? " beat" : ""}`} aria-hidden>
          <I.Next />
        </button>
        <button type="button" className={`c-sm${beat ? " beat" : ""}`} aria-hidden>
          <I.Repeat />
        </button>
      </div>
    </div>
  );
}

function Badge({ access, t }) {
  const owned = access === "full";
  return (
    <div
      style={{
        padding: "4px 11px",
        borderRadius: 20,
        background: "rgba(0,0,0,.52)",
        border: `1px solid ${owned ? `${t.p1}66` : "rgba(255,255,255,.15)"}`,
        fontFamily: "'DM Mono',monospace",
        fontSize: 8,
        letterSpacing: ".2em",
        color: owned ? t.accent : "rgba(255,255,255,.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {owned ? "✦ OWNED" : "PREVIEW"}
    </div>
  );
}

function ShareSheet({ title, sub, t, onClose }) {
  return (
    <div className="bsheet" style={{ background: t.dark }}>
      <div className="sheet-hdl" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClose()} />
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 24px 22px", cursor: "pointer" }} onClick={onClose}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            border: `1px solid ${t.p1}55`,
            background: t.glowDim,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: t.accent,
          }}
        >
          <I.Plus s={20} />
        </div>
        <div>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 400, color: "white" }}>{title}</div>
          <div
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 9,
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.35)",
              marginTop: 2,
            }}
          >
            {sub}
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewMoreSheet({ title, sub, t, rows, onClose }) {
  return (
    <div className="bsheet" style={{ background: t.dark, paddingBottom: 28 }}>
      <div className="sheet-hdl" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClose()} />
      <div style={{ padding: "6px 22px 10px" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 400, color: "white", marginBottom: 3 }}>{title}</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", textTransform: "uppercase", color: t.accent }}>{sub}</div>
      </div>
      {rows.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 22px",
            borderBottom: "1px solid rgba(255,255,255,.05)",
          }}
        >
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".15em", color: "rgba(255,255,255,.3)" }}>{k}</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.7)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function SingleModal({
  track,
  access = "preview",
  onClose,
  onAddToCart,
  onAddVinyl,
  onGift,
  onLibraryChange,
  releaseDetail,
}) {
  const coverSrc = trackCoverSrc(track || {});
  const palette = useCoverPalette(coverSrc, track?.coverArtType || track?.coverType || "image");
  const t = useMemo(() => buildTheme(palette), [palette]);
  const vars = useMemo(() => themeVars(t), [t]);

  const isPreview = access !== "full";
  const fullDur = parseDurSec(track) || 222;
  const duration = isPreview ? PREVIEW_CAP_SEC : fullDur || 222;

  const {
    state: { isPlaying, currentTime, duration: engineDuration },
    toggle,
    seek,
  } = useMediaEngine();

  const { mounted, closing, setClosing } = useModalAnim();
  const beat = useBeat(isPlaying);
  const [sheet, setSheet] = useState(null);

  usePlayerBodyState({ modalOpen: true });

  useEffect(() => {
    registerModal("immersive-preview-modal");
    return () => unregisterModal("immersive-preview-modal");
  }, []);

  const engineDur = engineDuration > 0 ? engineDuration : duration;
  const displayDuration = isPreview ? PREVIEW_CAP_SEC : engineDur;
  const displayCurrent = isPreview ? Math.min(currentTime, PREVIEW_CAP_SEC) : currentTime;

  const release = releaseDetail || track;
  const editorial = useMemo(() => getReleaseEditorial(release), [release]);
  const creditRows = useMemo(() => getCreditsDisplayRows(editorial), [editorial]);
  const viewMoreRows = useMemo(() => {
    const rows = [];
    if (editorial?.releaseDate || track?.year) rows.push(["RELEASE DATE", editorial?.releaseDate || track?.year]);
    if (editorial?.label) rows.push(["LABEL", editorial.label]);
    rows.push(["FORMAT", "Digital"]);
    rows.push(["DURATION", track?.dur || fmt(fullDur)]);
    if (editorial?.genre || track?.genre) rows.push(["GENRE", editorial?.genre || track?.genre]);
    if (creditRows.length) {
      creditRows.slice(0, 3).forEach(([k, v]) => rows.push([k.toUpperCase(), v]));
    }
    if (!rows.length) {
      rows.push(["ARTIST", track?.artist || "2MRRW"], ["TYPE", track?.type || "Single"]);
    }
    return rows;
  }, [editorial, track, creditRows, fullDur]);

  const close = useCallback(() => {
    setSheet(null);
    setClosing(true);
    setTimeout(onClose, 340);
  }, [onClose, setClosing]);

  const isVisible = mounted && !closing;
  const priceLabel = track?.price || track?.priceLabel || "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "flex-end",
        background: isVisible ? "rgba(0,0,0,.88)" : "rgba(0,0,0,0)",
        backdropFilter: isVisible ? "blur(7px)" : "blur(0px)",
        WebkitBackdropFilter: isVisible ? "blur(7px)" : "blur(0px)",
        transition: "background .35s ease, backdrop-filter .35s ease",
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          margin: "0 auto",
          height: "94dvh",
          maxHeight: 880,
          borderRadius: "22px 22px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: t.dark,
          boxShadow: `0 0 70px ${t.glowDim}, 0 -10px 60px rgba(0,0,0,.85)`,
          willChange: "transform",
          backfaceVisibility: "hidden",
          transform: closing ? "translateY(100%)" : mounted ? "translateY(0)" : "translateY(100%)",
          transition: closing
            ? "transform .34s cubic-bezier(.55,0,1,.45)"
            : "transform .44s cubic-bezier(.22,1,.36,1)",
          ...vars,
        }}
      >
        <div style={{ flex: "0 0 62%", position: "relative", overflow: "hidden" }}>
          <Scene coverUrl={coverSrc} t={t} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              pointerEvents: "none",
              background: "linear-gradient(to top,rgba(0,0,0,.94) 0%,rgba(0,0,0,.28) 44%,transparent 68%)",
            }}
          />
          <div style={{ position: "absolute", top: 14, left: 0, right: 0, zIndex: 30, display: "flex", justifyContent: "center" }}>
            <div className="drag-pill" onClick={close} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && close()} />
          </div>
          <div style={{ position: "absolute", top: 12, right: 14, zIndex: 30 }}>
            <Badge access={access} t={t} />
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div className="art-lbl" style={{ "--glow": t.glow, "--glow-dim": t.glowDim }}>
              {track?.title}
            </div>
          </div>
          {isPreview ? (
            <div style={{ position: "absolute", bottom: 108, left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 8,
                  letterSpacing: ".22em",
                  padding: "4px 12px",
                  borderRadius: 20,
                  background: "rgba(0,0,0,.6)",
                  border: "1px solid rgba(255,255,255,.12)",
                  color: "rgba(255,255,255,.45)",
                }}
              >
                30 SEC PREVIEW
              </div>
            </div>
          ) : null}
          <div style={{ position: "absolute", bottom: 100, left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => setSheet("more")}
              style={{
                background: "rgba(255,255,255,.07)",
                border: "1px solid rgba(255,255,255,.13)",
                color: "rgba(255,255,255,.65)",
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: ".22em",
                textTransform: "uppercase",
                padding: "7px 18px",
                borderRadius: 20,
                cursor: "pointer",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
              }}
            >
              View More
            </button>
          </div>
          <FloatingPlayer
            t={t}
            playing={isPlaying}
            current={displayCurrent}
            duration={displayDuration}
            isPreview={isPreview}
            beat={beat}
            onPlay={toggle}
            onSeekRatio={(r) => seek(r * displayDuration)}
          />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: t.dark, ...vars }}>
          <div style={{ flex: 1, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 30, fontWeight: 500, color: "white", lineHeight: 1.1, marginBottom: 6 }}>
                {track?.title}
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: ".3em", textTransform: "uppercase", color: t.accent }}>
                {track?.artist}
                {track?.feat ? ` · ft. ${track.feat}` : ""}
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, color: "rgba(255,255,255,.28)", letterSpacing: ".18em", marginTop: 4 }}>
                {track?.type || "Single"} · {isPreview ? "30 sec preview" : track?.dur || fmt(fullDur)}
              </div>
            </div>

            {isPreview ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 52 }}>
                <button
                  type="button"
                  className="icon-btn cart-pulse"
                  style={{ color: t.accent, "--glow": t.glow, "--glow-dim": t.glowDim }}
                  onClick={() => onAddToCart?.(track)}
                >
                  <I.Cart s={34} />
                </button>
                <Link href="/subscribe" className="icon-btn" style={{ color: t.accent, filter: `drop-shadow(0 0 6px ${t.glow})` }}>
                  <I.Sub s={28} />
                </Link>
                <button type="button" className="icon-btn" style={{ color: "rgba(255,255,255,.38)" }} onClick={() => (onGift ? onGift() : setSheet("share"))}>
                  <I.Plus s={26} />
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 52 }}>
                <button
                  type="button"
                  className="icon-btn col-glow"
                  style={{ color: t.accent, "--glow": t.glow }}
                  onClick={() => onLibraryChange?.()}
                >
                  <I.Coll s={30} />
                </button>
                <button type="button" className="icon-btn" style={{ color: "rgba(255,255,255,.38)" }} onClick={() => setSheet("share")}>
                  <I.Plus s={26} />
                </button>
              </div>
            )}

            {isPreview ? (
              <div
                style={{
                  padding: "14px 18px",
                  borderRadius: 14,
                  background: `linear-gradient(135deg,${t.glowDim},rgba(0,0,0,.3))`,
                  border: `1px solid ${t.p1}44`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.accent, marginBottom: 2 }}>Own this track</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,.35)", letterSpacing: ".1em" }}>
                    FULL QUALITY · {track?.dur || fmt(fullDur)}
                    {priceLabel ? ` · ${priceLabel}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAddToCart?.(track)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 20,
                    background: t.p1,
                    border: "none",
                    fontSize: 11,
                    fontWeight: 800,
                    color: "rgba(0,0,0,.9)",
                    cursor: "pointer",
                    letterSpacing: ".06em",
                    boxShadow: `0 0 20px ${t.glowDim}`,
                  }}
                >
                  BUY
                </button>
              </div>
            ) : (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  background: `linear-gradient(135deg,${t.glowDim},rgba(0,0,0,.2))`,
                  border: `1px solid ${t.p1}44`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: t.glow,
                    border: `1px solid ${t.accent}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={t.dark} strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="2,7 6,11 12,3" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.accent }}>You own this track</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,.35)", letterSpacing: ".1em" }}>
                    Full quality stream unlocked
                  </div>
                </div>
              </div>
            )}

            {onAddVinyl && isPreview ? (
              <button type="button" className="modal-immersive-vinyl-link" onClick={() => onAddVinyl(track)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.4)", fontSize: 11, cursor: "pointer" }}>
                + Add Vinyl (Optional)
              </button>
            ) : null}
          </div>
        </div>

        {sheet === "share" ? (
          <ShareSheet title={`Share ${track?.type || "Single"}`} sub={`${track?.title} · ${track?.artist}`} t={t} onClose={() => setSheet(null)} />
        ) : null}
        {sheet === "more" ? (
          <ViewMoreSheet title={track?.title} sub={`${track?.type || "Single"} · ${track?.artist}`} t={t} rows={viewMoreRows} onClose={() => setSheet(null)} />
        ) : null}
      </div>
    </div>
  );
}

function AlbumModalView({ album, access = "preview", onClose }) {
  const coverSrc = trackCoverSrc(album);
  const palette = useCoverPalette(coverSrc, album?.coverArtType || album?.coverType || "image");
  const t = useMemo(() => buildTheme(palette), [palette]);
  const vars = useMemo(() => themeVars(t), [t]);

  const tracks = Array.isArray(album?.tracks) ? album.tracks.filter(Boolean) : [];
  const { mounted, closing, setClosing } = useModalAnim();
  const [activeTrack, setActiveTrack] = useState(() => tracks[0] || null);
  const [sheet, setSheet] = useState(null);
  const [addTarget, setAddTarget] = useState(null);

  const { state: { isPlaying, currentTime, duration: engineDuration }, toggle, seek } = useMediaEngine();
  const beat = useBeat(isPlaying);

  usePlayerBodyState({ modalOpen: true });

  useEffect(() => {
    registerModal("immersive-album-modal");
    return () => unregisterModal("immersive-album-modal");
  }, []);

  useEffect(() => {
    if (!tracks.length) {
      setActiveTrack(null);
      return;
    }
    setActiveTrack((prev) => {
      if (prev && tracks.some((tr) => tr?.id === prev?.id)) return prev;
      return tracks[0];
    });
  }, [tracks]);

  const isPreview = access !== "full";
  const trackLocked = (tr) => isPreview && !tr?.free;
  const trackDur = (tr) => (isPreview && !tr?.free ? PREVIEW_CAP_SEC : parseDurSec(tr) || 180);
  const activeDur = activeTrack ? trackDur(activeTrack) : PREVIEW_CAP_SEC;
  const engineDur = engineDuration > 0 ? engineDuration : activeDur;
  const displayDuration = isPreview && activeTrack && !activeTrack?.free ? PREVIEW_CAP_SEC : engineDur;
  const displayCurrent =
    isPreview && activeTrack && !activeTrack?.free ? Math.min(currentTime, PREVIEW_CAP_SEC) : currentTime;
  const miniPct = displayDuration ? (displayCurrent / displayDuration) * 100 : 0;

  const close = useCallback(() => {
    setSheet(null);
    setClosing(true);
    setTimeout(onClose, 340);
  }, [onClose, setClosing]);

  const handleTrack = (tr) => {
    if (trackLocked(tr)) return;
    if (activeTrack?.id === tr.id) {
      toggle();
      return;
    }
    setActiveTrack(tr);
    seek(0);
  };

  const isVisible = mounted && !closing;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "flex-end",
        background: isVisible ? "rgba(0,0,0,.88)" : "rgba(0,0,0,0)",
        backdropFilter: isVisible ? "blur(7px)" : "blur(0px)",
        WebkitBackdropFilter: isVisible ? "blur(7px)" : "blur(0px)",
        transition: "background .35s ease, backdrop-filter .35s ease",
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          margin: "0 auto",
          height: "94dvh",
          maxHeight: 880,
          borderRadius: "22px 22px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: t.dark,
          boxShadow: `0 0 70px ${t.glowDim}, 0 -10px 60px rgba(0,0,0,.85)`,
          willChange: "transform",
          backfaceVisibility: "hidden",
          transform: closing ? "translateY(100%)" : mounted ? "translateY(0)" : "translateY(100%)",
          transition: closing
            ? "transform .34s cubic-bezier(.55,0,1,.45)"
            : "transform .44s cubic-bezier(.22,1,.36,1)",
          ...vars,
        }}
      >
        <div style={{ flex: "0 0 62%", position: "relative", overflow: "hidden" }}>
          <Scene coverUrl={coverSrc} t={t} />
          <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: "linear-gradient(to top,rgba(0,0,0,.94) 0%,rgba(0,0,0,.28) 44%,transparent 68%)" }} />
          <div style={{ position: "absolute", top: 14, left: 0, right: 0, zIndex: 30, display: "flex", justifyContent: "center" }}>
            <div className="drag-pill" onClick={close} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && close()} />
          </div>
          <div style={{ position: "absolute", top: 12, right: 14, zIndex: 30 }}>
            <Badge access={access} t={t} />
          </div>
          <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div className="art-lbl" style={{ "--glow": t.glow, "--glow-dim": t.glowDim }}>
              {album?.title}
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 100, left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "center" }}>
            <button type="button" onClick={() => setSheet("more")} style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.13)", color: "rgba(255,255,255,.65)", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".22em", textTransform: "uppercase", padding: "7px 18px", borderRadius: 20, cursor: "pointer", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
              View More
            </button>
          </div>
          <FloatingPlayer
            t={t}
            playing={isPlaying}
            current={displayCurrent}
            duration={displayDuration}
            isPreview={isPreview && activeTrack && !activeTrack?.free}
            beat={beat}
            onPlay={toggle}
            onSeekRatio={(r) => seek(r * displayDuration)}
          />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: t.dark, ...vars }}>
          <div style={{ flexShrink: 0, padding: "14px 20px 10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
            <div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".26em", textTransform: "uppercase", color: t.accent }}>
                {album?.type || "Album"} · {album?.year || ""}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 500, color: "white", lineHeight: 1.1, marginTop: 2 }}>{album?.title}</div>
              <div style={{ fontSize: 11, fontWeight: 300, color: "rgba(255,255,255,.38)", marginTop: 2 }}>
                {album?.artist} · {tracks.length} tracks
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-end", flexShrink: 0 }}>
              {isPreview && album?.price ? (
                <button type="button" style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${t.p1}`, background: t.glowDim, fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".15em", cursor: "pointer", color: t.accent }}>
                  {album.price} · Acquire
                </button>
              ) : null}
              <button type="button" onClick={() => setSheet("share")} style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", fontSize: 10, color: "rgba(255,255,255,.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <I.Plus s={12} /> Share
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
            {!tracks.length ? (
              <div style={{ padding: "24px 20px", fontSize: 12, color: "rgba(255,255,255,.45)", textAlign: "center" }}>
                Track list unavailable for this release.
              </div>
            ) : null}
            {tracks.map((tr, idx) => {
              const locked = trackLocked(tr);
              const isActive = activeTrack?.id === tr.id;
              const isPlayingThis = isActive && isPlaying;
              return (
                <div key={tr.id ?? idx} className={`tr${isActive ? " active-tr" : ""}${locked ? " locked" : ""}`} onClick={() => handleTrack(tr)}>
                  {isActive ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: t.p1, borderRadius: "0 1px 1px 0" }} /> : null}
                  <div style={{ width: 20, flexShrink: 0, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,.3)", display: "flex", gap: 2, alignItems: "flex-end", height: 13 }}>
                    {isPlayingThis ? (
                      <>
                        <div className="eq-b" style={{ background: t.p1 }} />
                        <div className="eq-b" style={{ background: t.p1 }} />
                        <div className="eq-b" style={{ background: t.p1 }} />
                      </>
                    ) : (
                      <span>{tr.id ?? idx + 1}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 400, color: isActive ? t.accent : "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tr.title}</div>
                    {tr.feat ? <div style={{ fontSize: 10, fontWeight: 300, color: "rgba(255,255,255,.35)" }}>ft. {tr.feat}</div> : null}
                  </div>
                  {tr.free ? (
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 7, letterSpacing: ".1em", padding: "2px 5px", borderRadius: 4, border: `1px solid ${t.p1}55`, color: t.accent, flexShrink: 0 }}>FREE</span>
                  ) : null}
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,.3)", flexShrink: 0 }}>{tr.dur}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: "transparent",
                        border: `1.5px solid ${isPlayingThis ? t.accent : `${t.p1}55`}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: locked ? "default" : "pointer",
                        color: isPlayingThis ? t.accent : "rgba(255,255,255,.55)",
                      }}
                      onClick={() => handleTrack(tr)}
                    >
                      {isPlayingThis ? <I.TrPause /> : <I.TrPlay />}
                    </button>
                    {!locked ? (
                      <button
                        type="button"
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,.15)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          color: "rgba(255,255,255,.4)",
                        }}
                        onClick={() => {
                          setAddTarget(tr);
                          setSheet("playlist");
                        }}
                      >
                        <I.Plus s={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div style={{ height: 4 }} />
          </div>

          <div style={{ flexShrink: 0, padding: "10px 18px 14px", borderTop: "1px solid rgba(255,255,255,.07)", display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2 }}>
              <div style={{ height: "100%", width: `${miniPct}%`, background: `linear-gradient(90deg,${t.p1},${t.accent})`, boxShadow: `0 0 6px ${t.glow}`, transition: "width .4s linear" }} />
            </div>
            <div style={{ width: 38, height: 38, borderRadius: 8, flexShrink: 0, background: `linear-gradient(135deg,${t.bg[0]},${t.bg[1]})`, border: `1px solid ${t.p1}30`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Cormorant Garamond',serif", fontSize: 16, color: t.accent }}>
              {(album?.title || "?").charAt(0)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeTrack?.title}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,.35)" }}>
                {album?.title} · {album?.artist}
              </div>
            </div>
            <button
              type="button"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: `1.5px solid ${t.p1}`,
                background: "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: t.accent,
                flexShrink: 0,
                boxShadow: isPlaying ? `0 0 12px ${t.glow}` : "none",
                transition: "box-shadow .2s",
              }}
              onClick={toggle}
            >
              {isPlaying ? <I.TrPause /> : <I.TrPlay />}
            </button>
          </div>
        </div>

        {sheet === "share" ? <ShareSheet title={`Share ${album?.type || "Album"}`} sub={`${album?.title} · ${album?.artist}`} t={t} onClose={() => setSheet(null)} /> : null}
        {sheet === "more" ? (
          <ViewMoreSheet
            title={album?.title}
            sub={`${album?.type || "Album"} · ${album?.artist}`}
            t={t}
            rows={[
              ["RELEASE DATE", album?.year || "—"],
              ["TRACKS", `${tracks.length} tracks`],
              ["FORMAT", "Digital"],
            ]}
            onClose={() => setSheet(null)}
          />
        ) : null}
        {sheet === "playlist" ? (
          <div className="bsheet" style={{ background: t.dark }}>
            <div className="sheet-hdl" onClick={() => setSheet(null)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSheet(null)} />
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".25em", textTransform: "uppercase", color: "rgba(255,255,255,.3)", padding: "2px 18px 8px" }}>
              Add &quot;{addTarget?.title}&quot; to playlist
            </div>
            <div style={{ padding: "16px 18px 24px", fontSize: 12, color: "rgba(255,255,255,.45)" }}>Playlists open from My Music.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AlbumModal(props) {
  const { album } = props;
  if (!album || (!album.slug && !album.id)) return null;
  return <AlbumModalView {...props} />;
}

export default function ImmersivePreviewModal({
  single: singleProp,
  track,
  access: accessProp,
  trackAccess,
  onClose,
  ...rest
}) {
  const single = singleProp || track;
  if (!single || (!single.slug && !single.id)) return null;
  const access = accessProp ?? (trackAccess?.canStream ? "full" : "preview");
  return (
    <SingleModal
      track={single}
      access={access}
      onClose={onClose}
      {...rest}
    />
  );
}
