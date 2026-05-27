"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import MusicPlusButton from "@/components/music/MusicPlusButton";

// V9 themes + helper components adapted for platform audio engine.
const THEMES = {
  dissolution: {
    p1: "#9b5de5", accent: "#c77dff",
    bg: ["#0d0020", "#1a0035", "#0a001a"],
    orb1: "radial-gradient(circle,rgba(155,93,229,.58),transparent 70%)",
    orb2: "radial-gradient(circle,rgba(106,13,173,.44),transparent 70%)",
    orb3: "radial-gradient(circle,rgba(199,125,255,.26),transparent 70%)",
    glow: "rgba(155,93,229,.6)", glowDim: "rgba(155,93,229,.2)",
    dark: "#08001a",
    cover: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=600&q=80",
  },
  signal_loss: {
    p1: "#f4a261", accent: "#ffe66d",
    bg: ["#1a0800", "#200e00", "#0d0400"],
    orb1: "radial-gradient(circle,rgba(244,162,97,.58),transparent 70%)",
    orb2: "radial-gradient(circle,rgba(231,111,81,.44),transparent 70%)",
    orb3: "radial-gradient(circle,rgba(255,230,109,.26),transparent 70%)",
    glow: "rgba(244,162,97,.6)", glowDim: "rgba(244,162,97,.2)",
    dark: "#0d0400",
    cover: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&q=80",
  },
  origin: {
    p1: "#0096c7", accent: "#48cae4",
    bg: ["#00111f", "#001a2e", "#000d17"],
    orb1: "radial-gradient(circle,rgba(0,150,199,.58),transparent 70%)",
    orb2: "radial-gradient(circle,rgba(2,62,138,.44),transparent 70%)",
    orb3: "radial-gradient(circle,rgba(72,202,228,.26),transparent 70%)",
    glow: "rgba(0,150,199,.6)", glowDim: "rgba(0,150,199,.2)",
    dark: "#00080f",
    cover: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&q=80",
  },
  tides: {
    p1: "#52b788", accent: "#95d5b2",
    bg: ["#071a10", "#0d2b1a", "#040e09"],
    orb1: "radial-gradient(circle,rgba(82,183,136,.58),transparent 70%)",
    orb2: "radial-gradient(circle,rgba(27,67,50,.44),transparent 70%)",
    orb3: "radial-gradient(circle,rgba(149,213,178,.26),transparent 70%)",
    glow: "rgba(82,183,136,.6)", glowDim: "rgba(82,183,136,.2)",
    dark: "#040e09",
    cover: "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&q=80",
  },
};

const fmt = s => {
  if (!s || isNaN(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

// ─────────────────────────────────────────────────────────────────────
// SVG ICON SET
// ─────────────────────────────────────────────────────────────────────
const I = {
  Play:    () => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><polygon points="6,3 18,11 6,19" fill="currentColor"/></svg>,
  Pause:   () => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="5" height="16" rx="2" fill="currentColor"/><rect x="13" y="3" width="5" height="16" rx="2" fill="currentColor"/></svg>,
  Prev:    () => <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><polygon points="14,3 4,9 14,15" fill="currentColor"/><rect x="2" y="3" width="3" height="12" rx="1" fill="currentColor"/></svg>,
  Next:    () => <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><polygon points="4,3 14,9 4,15" fill="currentColor"/><rect x="13" y="3" width="3" height="12" rx="1" fill="currentColor"/></svg>,
  Shuffle: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h3l7 8h2"/><path d="M12 2l2 2-2 2"/><path d="M12 10l2 2-2 2"/><path d="M9 6l-2-2H2"/></svg>,
  Repeat:  () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10v3l3-3-3-3v3"/><path d="M13 12H3V9l-3 3 3 3v-3"/></svg>,
  Cart:    ({ s=32 }) => <svg width={s} height={s} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h3l4 14h12l3-9H9"/><circle cx="13" cy="24" r="1.5" fill="currentColor" stroke="none"/><circle cx="22" cy="24" r="1.5" fill="currentColor" stroke="none"/></svg>,
  Sub:     ({ s=28 }) => <svg width={s} height={s} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="14" cy="14" r="10"/><path d="M14 9v5l3 3"/><path d="M14 4v2M14 22v2M4 14h2M22 14h2"/></svg>,
  Coll:    ({ s=28 }) => <svg width={s} height={s} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h12a2 2 0 012 2v16l-8-4-8 4V6a2 2 0 012-2z" fill="currentColor" fillOpacity=".15"/><path d="M8 4h12a2 2 0 012 2v16l-8-4-8 4V6a2 2 0 012-2z"/></svg>,
  Plus:    ({ s=26 }) => <svg width={s} height={s} viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="13" y1="4" x2="13" y2="22"/><line x1="4" y1="13" x2="22" y2="13"/></svg>,
  TrPlay:  () => <svg width="9" height="10" viewBox="0 0 9 10" fill="none"><polygon points="1,.5 8.5,5 1,9.5" fill="currentColor"/></svg>,
  TrPause: () => <svg width="9" height="10" viewBox="0 0 9 10" fill="none"><rect x="0" y="0" width="3" height="10" rx="1" fill="currentColor"/><rect x="6" y="0" width="3" height="10" rx="1" fill="currentColor"/></svg>,
};

// ─────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────

// Beat pulse — fires on every "imaginary beat" while playing
function useBeat(playing) {
  const [beat, setBeat] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!playing) return;
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

// Modal mount/close animation state
function useModalAnim() {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    // Double RAF ensures paint happens before transform kicks in
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, []);
  return { mounted, closing, setClosing };
}

// ─────────────────────────────────────────────────────────────────────
// SCENE — animated background per release
// Real cover art at 42% opacity + orbs + rays + scanlines + grain
// ─────────────────────────────────────────────────────────────────────
function Scene({ themeKey }) {
  const t = THEMES[themeKey];
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    const img = new Image();
    img.src = t.cover;
    img.onload = () => setLoaded(true);
  }, [themeKey]);
  return (
    <div className="sc" style={{ background: `linear-gradient(160deg,${t.bg[0]},${t.bg[1]},${t.bg[2]})` }}>
      <img src={t.cover} alt="" style={{
        position:"absolute", inset:0, width:"100%", height:"100%",
        objectFit:"cover",
        opacity: loaded ? 0.42 : 0,
        transition:"opacity .7s ease",
      }} />
      <div className="sc-orb orb-a" style={{ background: t.orb1 }} />
      <div className="sc-orb orb-b" style={{ background: t.orb2 }} />
      <div className="sc-orb orb-c" style={{ background: t.orb3 }} />
      <div className="sc-rays">
        {[0,1,2].map(i => (
          <div key={i} className="sc-ray" style={{ background: `linear-gradient(to bottom,transparent,${t.accent}38,transparent)` }} />
        ))}
      </div>
      <div className="sc-scan" />
      <div className="sc-grain" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WAVEFORM — animated bars above scrub bar
// ─────────────────────────────────────────────────────────────────────
function Waveform({ playing, themeKey, bars = 26 }) {
  const t = THEMES[themeKey];
  const [sc, setSc] = useState(() => Array(bars).fill(0.15));
  const ref = useRef(null);
  useEffect(() => {
    if (!playing) { setSc(Array(bars).fill(0.15)); return; }
    const tick = () => {
      setSc(Array(bars).fill(0).map((_, i) => {
        const c = bars / 2, d = Math.abs(i - c) / c;
        return Math.max(0.1, Math.min(1, Math.random() * (1 - d * 0.4) + 0.1));
      }));
      ref.current = setTimeout(tick, 70 + Math.random() * 55);
    };
    tick();
    return () => clearTimeout(ref.current);
  }, [playing, bars]);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:18, justifyContent:"center", marginBottom:8 }}>
      {sc.map((s, i) => (
        <div key={i} style={{
          width:3, borderRadius:2, height:18,
          transformOrigin:"bottom", transform:`scaleY(${s})`,
          background:`linear-gradient(to top,${t.p1},${t.accent})`,
          transition:"transform .08s ease",
        }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SCRUB BAR — with drag handle + dashed preview cap
// ─────────────────────────────────────────────────────────────────────
function ScrubBar({ pct, themeKey, onSeekRatio, isPreview }) {
  const t = THEMES[themeKey];
  const barRef = useRef(null);
  const handle = e => {
    const rect = (barRef.current || e.currentTarget).getBoundingClientRect();
    const cx = e.touches?.[0]?.clientX ?? e.clientX;
    onSeekRatio(Math.max(0, Math.min(1, (cx - rect.left) / rect.width)));
  };
  return (
    <div ref={barRef} onClick={handle} onTouchStart={handle} style={{
      width:"100%", height:4, background:"rgba(255,255,255,.12)",
      borderRadius:4, cursor:"pointer", position:"relative", flexShrink:0,
    }}>
      {/* Dashed preview cap — shows 30s limit to visitor */}
      {isPreview && (
        <div style={{
          position:"absolute", left:0, top:0, bottom:0, width:"30%",
          borderRight:`1px dashed ${t.p1}60`, pointerEvents:"none",
        }} />
      )}
      <div style={{
        width:`${Math.min(100, pct)}%`, height:"100%", borderRadius:4,
        background:`linear-gradient(90deg,${t.p1},${t.accent})`,
        boxShadow:`0 0 8px ${t.glow}`, transition:"width .1s linear",
        position:"relative",
      }}>
        {pct > 2 && (
          <div style={{
            position:"absolute", right:-6, top:"50%", transform:"translateY(-50%)",
            width:12, height:12, borderRadius:"50%",
            background:t.accent, boxShadow:`0 0 8px ${t.glow}`,
          }} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FLOATING PLAYER — lives at bottom of art zone (62%)
// Waveform → scrub bar → shuffle/prev/play/next/repeat
// ─────────────────────────────────────────────────────────────────────
function FloatingPlayer({ themeKey, playing, current, duration, isPreview, beat, onPlay, onSeekRatio }) {
  const t = THEMES[themeKey];
  const pct = duration ? (current / duration) * 100 : 0;
  const vars = {
    "--glow": t.glow, "--glow-dim": t.glowDim,
    "--p1": t.p1, "--p1-dim": `${t.p1}55`, "--p1-dim2": `${t.p1}22`,
    "--accent": t.accent,
  };
  return (
    <div style={{
      position:"absolute", bottom:0, left:0, right:0, zIndex:10,
      padding:"10px 20px 16px",
      background:"linear-gradient(to top,rgba(0,0,0,.92) 0%,rgba(0,0,0,.55) 60%,transparent 100%)",
      ...vars,
    }}>
      <Waveform playing={playing} themeKey={themeKey} bars={26} />
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"rgba(255,255,255,.38)", flexShrink:0, minWidth:28 }}>
          {fmt(current)}
        </span>
        <ScrubBar pct={pct} themeKey={themeKey} onSeekRatio={onSeekRatio} isPreview={isPreview} />
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"rgba(255,255,255,.38)", flexShrink:0, minWidth:28, textAlign:"right" }}>
          {isPreview ? "0:30" : fmt(duration)}
        </span>
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 4px", ...vars }}>
        <button className={`c-sm${beat ? " beat" : ""}`}><I.Shuffle /></button>
        <button className={`c-md${beat ? " beat" : ""}`}><I.Prev /></button>
        <button className={`c-lg${playing ? " playing" : ""}${beat ? " beat" : ""}`} onClick={onPlay} style={vars}>
          {playing ? <I.Pause /> : <I.Play />}
        </button>
        <button className={`c-md${beat ? " beat" : ""}`}><I.Next /></button>
        <button className={`c-sm${beat ? " beat" : ""}`}><I.Repeat /></button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// OWNERSHIP BADGE
// Reads access prop: "full" = owner, anything else = visitor preview
// ─────────────────────────────────────────────────────────────────────
function Badge({ access, themeKey }) {
  const t = THEMES[themeKey];
  const owned = access === "full";
  return (
    <div style={{
      padding:"4px 11px", borderRadius:20,
      background:"rgba(0,0,0,.52)",
      border:`1px solid ${owned ? t.p1 + "66" : "rgba(255,255,255,.15)"}`,
      fontFamily:"'DM Mono',monospace", fontSize:8, letterSpacing:".2em",
      color: owned ? t.accent : "rgba(255,255,255,.45)",
      backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
    }}>
      {owned ? "✦ OWNED" : "PREVIEW"}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SHARE SHEET
// ─────────────────────────────────────────────────────────────────────
function ShareSheet({ title, sub, themeKey, onClose }) {
  const t = THEMES[themeKey];
  return (
    <div className="bsheet" style={{ background: t.dark }}>
      <div className="sheet-hdl" onClick={onClose} />
      <div style={{ display:"flex", alignItems:"center", gap:16, padding:"10px 24px 22px", cursor:"pointer" }} onClick={onClose}>
        <div style={{
          width:46, height:46, borderRadius:13,
          border:`1px solid ${t.p1}55`, background:t.glowDim,
          display:"flex", alignItems:"center", justifyContent:"center", color:t.accent,
        }}>
          <I.Plus s={20} />
        </div>
        <div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:22, fontWeight:400, color:"white" }}>{title}</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:".18em", textTransform:"uppercase", color:"rgba(255,255,255,.35)", marginTop:2 }}>{sub}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VIEW MORE SHEET — track/album metadata
// ─────────────────────────────────────────────────────────────────────
function ViewMoreSheet({ title, sub, themeKey, rows, onClose }) {
  const t = THEMES[themeKey];
  return (
    <div className="bsheet" style={{ background: t.dark, paddingBottom:28 }}>
      <div className="sheet-hdl" onClick={onClose} />
      <div style={{ padding:"6px 22px 10px" }}>
        <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:22, fontWeight:400, color:"white", marginBottom:3 }}>{title}</div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:".2em", textTransform:"uppercase", color:t.accent }}>{sub}</div>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"10px 22px", borderBottom:"1px solid rgba(255,255,255,.05)" }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:".15em", color:"rgba(255,255,255,.3)" }}>{k}</span>
          <span style={{ fontSize:11, color:"rgba(255,255,255,.7)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SINGLE MODAL
//
// VISITOR (access="preview"):
//   - "PREVIEW" badge top-right
//   - 30s cap on scrub bar (dashed line)
//   - Action row: Cart (pulse glow) · Subscribe · Share
//   - CTA panel: "Own this track" + price + BUY button
//
// OWNER (access="full"):
//   - "✦ OWNED" badge top-right
//   - Full duration unlocked
//   - Action row: Collection bookmark (glow) · Share
//   - Confirmation panel: "You own this track"
// ─────────────────────────────────────────────────────────────────────

function SingleModal({ track, access, onClose }) {
  const t = THEMES[track.themeKey] || THEMES.dissolution;
  const isPreview = access === "preview";
  const { mounted, closing, setClosing } = useModalAnim();
  const [sheet, setSheet] = useState(null); // null | "more"
  const trackAccess = useMemo(
    () => ({ canStream: !isPreview, canAddToLibrary: !isPreview, canAddToPlaylist: !isPreview }),
    [isPreview]
  );

  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    playTrack,
    toggle,
    seek,
  } = useAudioPlayer();

  const engineTrack = useMemo(() => {
    const prevAccess = track?.metadata?.access || {};
    return {
      ...track,
      metadata: {
        ...(track?.metadata || {}),
        access: {
          ...prevAccess,
          previewOnly: isPreview,
          canStream: !isPreview,
        },
      },
    };
  }, [track, isPreview]);

  const isThisTrack = Boolean(engineTrack?.slug && currentTrack?.slug === engineTrack.slug);
  const playing = Boolean(isThisTrack && isPlaying);

  const effectiveDuration = useMemo(() => {
    const d = Number.isFinite(duration) ? duration : 0;
    if (isPreview) return Math.min(d || 30, 30);
    return d;
  }, [duration, isPreview]);

  const effectiveCurrent = useMemo(() => {
    const c = Number.isFinite(currentTime) ? currentTime : 0;
    if (isPreview) return Math.min(c, 30);
    return c;
  }, [currentTime, isPreview]);

  const beat = useBeat(playing);

  useEffect(() => {
    if (!mounted) return;
    if (!engineTrack) return;
    if (!isThisTrack) {
      void playTrack({ ...engineTrack }, { resumeAt: 0 });
      return;
    }
    return;
  }, [mounted, engineTrack, isThisTrack, playTrack]);

  const close = useCallback(() => {
    setSheet(null);
    setClosing(true);
    setTimeout(onClose, 340);
  }, [onClose, setClosing]);

  const handlePlayPause = useCallback(() => {
    if (!engineTrack) return;
    if (!isThisTrack) {
      void playTrack({ ...engineTrack }, { resumeAt: 0 });
      return;
    }
    toggle();
  }, [engineTrack, isThisTrack, playTrack, toggle]);

  const handleSeekRatio = useCallback(
    (r) => {
      if (!Number.isFinite(r)) return;
      const d = effectiveDuration || (isPreview ? 30 : 0);
      const next = Math.max(0, Math.min(d, r * d));
      seek(next);
    },
    [effectiveDuration, isPreview, seek]
  );

  const isVisible = mounted && !closing;
  const vars = {
    "--glow": t.glow,
    "--glow-dim": t.glowDim,
    "--p1": t.p1,
    "--p1-dim": `${t.p1}55`,
    "--p1-dim2": `${t.p1}22`,
    "--accent": t.accent,
  };

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
          transform: closing
            ? "translateY(100%)"
            : mounted
              ? "translateY(0)"
              : "translateY(100%)",
          transition: closing
            ? "transform .34s cubic-bezier(.55,0,1,.45)"
            : "transform .44s cubic-bezier(.22,1,.36,1)",
          ...vars,
        }}
      >
        {/* ══ ART ZONE — 62% ══ */}
        <div style={{ flex: "0 0 62%", position: "relative", overflow: "hidden" }}>
          <Scene themeKey={track.themeKey} />

          {/* Bottom fade */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              pointerEvents: "none",
              background:
                "linear-gradient(to top,rgba(0,0,0,.94) 0%,rgba(0,0,0,.28) 44%,transparent 68%)",
            }}
          />

          {/* Drag pill — tap to dismiss */}
          <div
            style={{
              position: "absolute",
              top: 14,
              left: 0,
              right: 0,
              zIndex: 30,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div className="drag-pill" onClick={close} />
          </div>

          {/* Ownership badge */}
          <div style={{ position: "absolute", top: 12, right: 14, zIndex: 30 }}>
            <Badge access={access} themeKey={track.themeKey} />
          </div>

          {/* Title watermark */}
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
              {track.title}
            </div>
          </div>

          {/* 30 SEC PREVIEW label (visitor only) */}
          {isPreview && (
            <div
              style={{
                position: "absolute",
                bottom: 108,
                left: 0,
                right: 0,
                zIndex: 10,
                display: "flex",
                justifyContent: "center",
              }}
            >
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
          )}

          {/* View More */}
          <div
            style={{
              position: "absolute",
              bottom: 100,
              left: 0,
              right: 0,
              zIndex: 10,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <button
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
            themeKey={track.themeKey}
            playing={playing}
            current={effectiveCurrent}
            duration={effectiveDuration || (isPreview ? 30 : 0)}
            isPreview={isPreview}
            beat={beat}
            onPlay={handlePlayPause}
            onSeekRatio={handleSeekRatio}
          />
        </div>

        {/* ══ INFO ZONE — 38% ══ */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: t.dark,
            ...vars,
          }}
        >
          <div
            style={{
              flex: 1,
              padding: "20px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 18,
              overflowY: "auto",
            }}
          >
            {/* Track title + meta */}
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond',serif",
                  fontSize: 30,
                  fontWeight: 500,
                  color: "white",
                  lineHeight: 1.1,
                  marginBottom: 6,
                }}
              >
                {track.title}
              </div>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: ".3em",
                  textTransform: "uppercase",
                  color: t.accent,
                }}
              >
                {track.artist}
                {track.feat && ` · ft. ${track.feat}`}
              </div>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 8,
                  color: "rgba(255,255,255,.28)",
                  letterSpacing: ".18em",
                  marginTop: 4,
                }}
              >
                {track.type} · {isPreview ? "30 sec preview" : track.dur}
              </div>
            </div>

            {/* ── VISITOR action row ── */}
            {isPreview ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 52 }}>
                <button
                  className="icon-btn cart-pulse"
                  style={{ color: t.accent, "--glow": t.glow, "--glow-dim": t.glowDim }}
                >
                  <I.Cart s={34} />
                </button>
                <button
                  className="icon-btn"
                  style={{ color: t.accent, filter: `drop-shadow(0 0 6px ${t.glow})` }}
                >
                  <I.Sub s={28} />
                </button>
                <MusicPlusButton
                  track={track}
                  access={trackAccess}
                  sheetBg={t.dark}
                  style={{ color: "rgba(255,255,255,.55)" }}
                />
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 52 }}>
                <button className="icon-btn col-glow" style={{ color: t.accent, "--glow": t.glow }}>
                  <I.Coll s={30} />
                </button>
                <MusicPlusButton
                  track={track}
                  access={trackAccess}
                  sheetBg={t.dark}
                  style={{ color: "rgba(255,255,255,.55)" }}
                />
              </div>
            )}

            {/* ── VISITOR CTA panel ── */}
            {isPreview && (
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.accent, marginBottom: 2 }}>
                    Own this track
                  </div>
                  <div
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 9,
                      color: "rgba(255,255,255,.35)",
                      letterSpacing: ".1em",
                    }}
                  >
                    FULL QUALITY · {track.dur} · {track.price}
                  </div>
                </div>
                <button
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
            )}

            {/* ── OWNER confirmation panel ── */}
            {!isPreview && (
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
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke={t.dark}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="2,7 6,11 12,3" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.accent }}>You own this track</div>
                  <div
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 9,
                      color: "rgba(255,255,255,.35)",
                      letterSpacing: ".1em",
                    }}
                  >
                    Full quality stream unlocked
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {sheet === "more" && (
          <ViewMoreSheet
            title={track.title}
            sub={`${track.type} · ${track.artist}`}
            themeKey={track.themeKey}
            rows={[
              ["RELEASE DATE", "2024"],
              ["LABEL", "2MRRW Independent"],
              ["FORMAT", "Digital · 320kbps"],
              ["DURATION", track.dur],
              ["GENRE", "Electronic · Alt R&B"],
            ]}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
    </div>
  );
}

export default function ImmersivePreviewModal({ single, track, onClose }) {
  const resolvedTrack = track || single;
  if (!resolvedTrack) return null;
  const canStream = Boolean(resolvedTrack?.metadata?.access?.canStream);
  const access = canStream ? "full" : "preview";
  return <SingleModal track={resolvedTrack} access={access} onClose={onClose} />;
}
