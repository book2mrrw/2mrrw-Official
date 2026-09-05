"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { useCoverPalette } from "@/hooks/useCoverPalette";
import { useMediaEngine } from "@/media/useMediaEngine";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import { getReleaseEditorial, getCreditsDisplayRows } from "@/components/preview/releaseMetadata";
import { usePlayerBodyState } from "@/lib/player/usePlayerBodyState";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";
import { useEntitlementAccountState } from "@/context/AuthContext";
import { useAudioPlayer } from "@/context/AudioContext";
import { resolveSubscriptionEntitlements } from "@/lib/commerce/entitlements";
import { PREVIEW_HARD_CAP_SEC } from "@/lib/playback/PlaybackEventHandlers";
import {
  albumTracksForPlayback,
  describeAlbumQueuePlaybackFailure,
  isSamePlaybackTrack,
} from "@/lib/music-playback";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import GlyphLyricsPanel from "@/components/preview/GlyphLyricsPanel";
import { postLibraryAdd } from "@/lib/library-client";
import { queueOfflineDownload, isOfflineCached, removeOfflineCache } from "@/lib/offline-cache";
import { loadPlaylists, addTrackToPlaylist, createPlaylist } from "@/lib/playlists";
import { getCatalogSurfaceRef } from "@/lib/storefront/catalog-surface-ref";
import { useArtworkGesture } from "@/hooks/useArtworkGesture";

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

// A release with an animated/video cover (e.g. a Mixtape/EP whose canonical
// entry sets `video`) resolves catalogCoverDisplay's `src` to a video URL —
// correct for the hero <CoverArt> display, which knows how to play it, but
// this is a small static nav thumbnail with no <video> element at all. An
// <img> pointed at a video URL just fails to render with no visible error,
// which is exactly what made one release's thumbnail silently blank while
// its non-video siblings rendered fine. Use the release's own static
// fallback image instead — the same one CoverArt itself falls back to when
// a video fails to load — so this can never happen for any release's cover.
function moreReleaseThumbSrc(r) {
  const { src, type } = catalogCoverDisplay(r || {});
  if (type === "video") return r?.baseCover || r?.legacy_cover || "";
  return src;
}

function MoreReleaseThumb({ r, accentColor, onClick }) {
  const [failed, setFailed] = useState(false);
  const thumbSrc = !failed ? moreReleaseThumbSrc(r) : "";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ flexShrink: 0, width: 76, background: "none", border: "none", padding: 0, cursor: "pointer", scrollSnapAlign: "start", textAlign: "left" }}
    >
      <div style={{ width: 76, height: 76, borderRadius: 9, overflow: "hidden", border: "1px solid rgba(255,255,255,.1)", background: "#111" }}>
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Cormorant Garamond',serif", fontSize: 22, color: accentColor }}>{(r.title || "?").charAt(0)}</div>
        )}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 76 }}>{r.title}</div>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 7, letterSpacing: ".1em", color: "rgba(255,255,255,.22)", marginTop: 1 }}>{r.type || r.release_type || "Release"}</div>
    </button>
  );
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
  SkipBack: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <polyline points="5,2 1,4.5 5,7" fill="none" />
      <path d="M1 4.5A8 8 0 1 1 1 13.5" fill="none" />
      <text x="5.2" y="11.8" fontSize="5.2" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="700">15</text>
    </svg>
  ),
  SkipFwd: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <polyline points="13,2 17,4.5 13,7" fill="none" />
      <path d="M17 4.5A8 8 0 1 0 17 13.5" fill="none" />
      <text x="5.2" y="11.8" fontSize="5.2" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="700">15</text>
    </svg>
  ),
  RepeatOne: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10v3l3-3-3-3v3" />
      <path d="M13 12H3V9l-3 3 3 3v-3" />
      <text x="6.5" y="9.5" fontSize="5" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="700">1</text>
    </svg>
  ),
  Moon: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z" />
    </svg>
  ),
  CloudDown: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 9.5A2.5 2.5 0 0 1 4 4.5a3.5 3.5 0 0 1 6.5 1 2 2 0 0 1-.5 4" />
      <path d="M7 7v5M5 10l2 2 2-2" />
    </svg>
  ),
  HeartOut: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13.5S1.5 9 1.5 5.5a3.5 3.5 0 0 1 6.5-1.7A3.5 3.5 0 0 1 14.5 5.5C14.5 9 8 13.5 8 13.5z" />
    </svg>
  ),
  HeartFill: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 13.5S1.5 9 1.5 5.5a3.5 3.5 0 0 1 6.5-1.7A3.5 3.5 0 0 1 14.5 5.5C14.5 9 8 13.5 8 13.5z" />
    </svg>
  ),
  VolumeIcon: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5H5L8 2v10L5 9H2V5z" />
      <path d="M10 4a3.5 3.5 0 0 1 0 6" />
    </svg>
  ),
  Dots: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  ),
  PlayNext: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="2,2 9,7 2,12" fill="currentColor" stroke="none" />
      <line x1="11" y1="2" x2="11" y2="12" />
    </svg>
  ),
  AddQueue: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="4" x2="9" y2="4" />
      <line x1="2" y1="7" x2="9" y2="7" />
      <line x1="2" y1="10" x2="6" y2="10" />
      <line x1="11" y1="8" x2="11" y2="13" />
      <line x1="8.5" y1="10.5" x2="13.5" y2="10.5" />
    </svg>
  ),
  ListPlus: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="4" x2="10" y2="4" />
      <line x1="2" y1="7" x2="10" y2="7" />
      <line x1="2" y1="10" x2="7" y2="10" />
      <line x1="10.5" y1="9" x2="10.5" y2="13" />
      <line x1="8.5" y1="11" x2="12.5" y2="11" />
    </svg>
  ),
  ShareArrow: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2l3 3-3 3" />
      <path d="M12 5H5a3 3 0 0 0-3 3v2" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,7 5.5,10.5 12,4" />
    </svg>
  ),
  Queue: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="10" y2="12" />
    </svg>
  ),
  DownloadAll: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l3 3 3-3" />
      <path d="M7 2v8" />
      <line x1="2" y1="12" x2="12" y2="12" />
    </svg>
  ),
  Mic: () => (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
      <rect x="2.5" y="0.5" width="3" height="4" rx="1.5" fill="currentColor" fillOpacity=".35" />
      <path d="M1.5 4a2.5 2.5 0 0 0 5 0" />
    </svg>
  ),
  Grip: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
      <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
      <circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" />
    </svg>
  ),
  Trash: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,3 12,3" /><path d="M4,3V2a1,1 0 0,1 1-1h3a1,1 0 0,1 1,1v1" />
      <path d="M2,3l.8,8.1A1,1 0 0,0 3.8,12h5.4a1,1 0 0,0 1-.9L11,3" />
    </svg>
  ),
  Radio: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="2.5" />
      <path d="M3.5 10.5a5 5 0 0 1 0-7" /><path d="M10.5 3.5a5 5 0 0 1 0 7" />
      <path d="M1.5 12.5a8 8 0 0 1 0-11" /><path d="M12.5 1.5a8 8 0 0 1 0 11" />
    </svg>
  ),
  Speed: ({ rate = 1 }) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="7" cy="8" r="5" />
      <line x1="7" y1="8" x2="10" y2="4.5" />
      <circle cx="7" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  History: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <polyline points="2,2 2,6 6,6" /><path d="M2 6A6 6 0 1 1 3.5 10" />
      <polyline points="7,4 7,7 9,9" />
    </svg>
  ),
  Artist: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="4.5" r="2.5" />
      <path d="M1.5 12.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    </svg>
  ),
  RemoveDownload: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l3 3 3-3" /><path d="M7 2v8" /><line x1="2" y1="12" x2="12" y2="12" />
      <line x1="10.5" y1="3" x2="13.5" y2="6" strokeWidth="1.2" />
      <line x1="13.5" y1="3" x2="10.5" y2="6" strokeWidth="1.2" />
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

function useModalAnim(open = true, persistent = false) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (persistent || !open) return undefined;
    let r2 = null;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2 != null) cancelAnimationFrame(r2);
    };
  }, [open, persistent]);
  return {
    mounted: persistent ? open : mounted,
    closing: persistent ? false : closing,
    setClosing,
  };
}

function PersistentCoverVideo({ active, ...props }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      void video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  }, [active]);
  return <video ref={videoRef} {...props} />;
}

function Scene({ coverUrl, t }) {
  // loadedUrl tracks which URL actually resolved. `loaded` is derived:
  // true only when the resolved URL matches the current prop — auto-false on URL change
  // without any synchronous setState in the effect body.
  const [loadedUrl, setLoadedUrl] = useState(null);
  const loaded = loadedUrl === coverUrl && Boolean(coverUrl);
  useEffect(() => {
    if (!coverUrl) return;
    const img = new Image();
    img.src = coverUrl;
    img.onload  = () => setLoadedUrl(coverUrl);
    img.onerror = () => setLoadedUrl(null);
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
  // Derived: idle bars when not playing — avoids synchronous setState in the effect body.
  const displayedSc = playing ? sc : Array(bars).fill(0.15);
  useEffect(() => {
    if (!playing) return undefined;
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
      {displayedSc.map((s, i) => (
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
  const draggingRef = useRef(false);

  const seekAt = useCallback((e) => {
    // Preview is fixed-position by design — non-interactive, even though this
    // bar still visually shows progress. Enforced again in seekInternal, but
    // this prevents the dead drag/click interaction from engaging at all.
    if (isPreview) return;
    const rect = (barRef.current || e.currentTarget).getBoundingClientRect();
    const cx = e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? e.clientX;
    onSeekRatio(Math.max(0, Math.min(1, (cx - rect.left) / rect.width)));
  }, [isPreview, onSeekRatio]);

  const onMouseDown = useCallback((e) => {
    if (isPreview) return;
    e.preventDefault();
    draggingRef.current = true;
    seekAt(e);
    const onMove = (ev) => { if (draggingRef.current) seekAt(ev); };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isPreview, seekAt]);

  const onTouchMove = useCallback((e) => {
    if (isPreview) return;
    e.preventDefault();
    seekAt(e);
  }, [isPreview, seekAt]);

  return (
    <div
      ref={barRef}
      onMouseDown={onMouseDown}
      onTouchStart={seekAt}
      onTouchMove={onTouchMove}
      role="slider"
      aria-valuenow={pct}
      aria-disabled={isPreview || undefined}
      tabIndex={isPreview ? -1 : 0}
      style={{
        width: "100%",
        height: 4,
        background: "rgba(255,255,255,.12)",
        borderRadius: 4,
        cursor: isPreview ? "default" : "pointer",
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

function FloatingPlayer({
  t, playing, current, duration, isPreview, beat,
  onPlay, onSeekRatio, onPrev, onNext,
  onSkipBack, onSkipFwd,
  onToggleShuffle, shuffleOn,
  onToggleRepeat, repeatMode,
}) {
  const pct = duration ? (current / duration) * 100 : 0;
  const vars = themeVars(t);
  const activeStyle = { color: t.accent, filter: `drop-shadow(0 0 5px ${t.glow})` };
  const dimStyle = { opacity: 0.35, cursor: "default" };
  const RepeatIcon = repeatMode === "one" ? I.RepeatOne : I.Repeat;
  const repeatActive = repeatMode && repeatMode !== "off";
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingRight: 18 }}>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,.38)", flexShrink: 0, minWidth: 28 }}>
          {fmt(current)}
        </span>
        <ScrubBar pct={pct} t={t} onSeekRatio={onSeekRatio} isPreview={isPreview} />
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "rgba(255,255,255,.38)", flexShrink: 0, minWidth: 28, textAlign: "right" }}>
          {isPreview ? fmt(PREVIEW_HARD_CAP_SEC) : fmt(duration)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px", ...vars }}>
        <button
          type="button"
          className="c-sm"
          aria-label="Shuffle"
          onClick={onToggleShuffle ?? undefined}
          style={shuffleOn ? activeStyle : !onToggleShuffle ? dimStyle : undefined}
        >
          <I.Shuffle />
        </button>
        <button
          type="button"
          className="c-sm"
          aria-label="Skip back 15 seconds"
          onClick={onSkipBack ?? undefined}
          style={!onSkipBack ? dimStyle : undefined}
        >
          <I.SkipBack />
        </button>
        <button
          type="button"
          className="c-md"
          onClick={onPrev}
          disabled={!onPrev}
          aria-label="Previous track"
          style={!onPrev ? dimStyle : undefined}
        >
          <I.Prev />
        </button>
        <button type="button" className={`c-lg${playing ? " playing" : ""}`} onClick={onPlay} style={vars}>
          {playing ? <I.Pause /> : <I.Play />}
        </button>
        <button
          type="button"
          className="c-md"
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next track"
          style={!onNext ? dimStyle : undefined}
        >
          <I.Next />
        </button>
        <button
          type="button"
          className="c-sm"
          aria-label="Skip forward 15 seconds"
          onClick={onSkipFwd ?? undefined}
          style={!onSkipFwd ? dimStyle : undefined}
        >
          <I.SkipFwd />
        </button>
        <button
          type="button"
          className="c-sm"
          aria-label={repeatMode === "off" ? "Enable repeat" : repeatMode === "all" ? "Repeat one" : "Disable repeat"}
          onClick={onToggleRepeat ?? undefined}
          style={repeatActive ? activeStyle : !onToggleRepeat ? dimStyle : undefined}
        >
          <RepeatIcon />
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
    <div className="bsheet" style={{ background: t.dark, paddingBottom: "max(0px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
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
    <div className="bsheet" style={{ background: t.dark, paddingBottom: "max(28px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
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

function SleepTimerSheet({ t, sleepTimerEndsAt, sleepAfterCurrentTrack, setSleepTimer, onClose }) {
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sleepTimerEndsAt) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sleepTimerEndsAt]);
  const active = sleepTimerEndsAt != null || sleepAfterCurrentTrack;
  const remaining = sleepTimerEndsAt ? Math.max(0, Math.ceil((sleepTimerEndsAt - clockNow) / 60000)) : null;
  const opts = [
    { label: "15 minutes", value: 15 },
    { label: "30 minutes", value: 30 },
    { label: "45 minutes", value: 45 },
    { label: "60 minutes", value: 60 },
    { label: "End of track", value: "end_of_track" },
  ];
  return (
    <div className="bsheet" style={{ background: t.dark, paddingBottom: "max(28px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <div className="sheet-hdl" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClose()} />
      <div style={{ padding: "6px 22px 14px" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 400, color: "white", marginBottom: 2 }}>Sleep Timer</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".15em", color: active ? t.accent : "rgba(255,255,255,.35)" }}>
          {sleepAfterCurrentTrack ? "AFTER CURRENT TRACK" : remaining != null ? `${remaining} MINUTES REMAINING` : "STOP PLAYBACK AFTER"}
        </div>
      </div>
      {opts.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => { setSleepTimer?.(opt.value); onClose(); }}
          style={{ width: "100%", padding: "13px 22px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left", fontSize: 14, color: "rgba(255,255,255,.82)", cursor: "pointer" }}
        >
          {opt.label}
        </button>
      ))}
      {active ? (
        <button
          type="button"
          onClick={() => { setSleepTimer?.(0); onClose(); }}
          style={{ width: "100%", padding: "13px 22px", background: "transparent", border: "none", textAlign: "left", fontSize: 14, color: "rgba(255,100,100,.75)", cursor: "pointer" }}
        >
          Cancel Timer
        </button>
      ) : null}
    </div>
  );
}

function TrackContextSheet({ track, album, t, onPlayNext, onAddToQueue, onAddToPlaylist, onShare, onSaveToLibrary, onStartRadio, onGoToArtist, onRemoveFromDownloads, isCached, onClose }) {
  const actions = [
    { label: "Play Next", icon: <I.PlayNext />, fn: onPlayNext },
    { label: "Add to Queue", icon: <I.AddQueue />, fn: onAddToQueue },
    { label: "Start Radio", icon: <I.Radio />, fn: onStartRadio },
    { label: "Add to Playlist", icon: <I.ListPlus />, fn: onAddToPlaylist },
    { label: "Save to Library", icon: <I.HeartOut />, fn: onSaveToLibrary },
    { label: "Go to Artist", icon: <I.Artist />, fn: onGoToArtist },
    ...(isCached ? [{ label: "Remove Download", icon: <I.RemoveDownload />, fn: onRemoveFromDownloads, danger: true }] : []),
    { label: "Share Track", icon: <I.ShareArrow />, fn: onShare },
  ];
  return (
    <div className="bsheet" style={{ background: t.dark, paddingBottom: "max(32px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <div className="sheet-hdl" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClose()} />
      <div style={{ padding: "4px 22px 14px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, fontWeight: 500, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track?.title}</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".18em", textTransform: "uppercase", color: t.accent, marginTop: 2 }}>{album?.artist} · {album?.title}</div>
      </div>
      {actions.map(({ label, icon, fn, danger }) => (
        <button
          key={label}
          type="button"
          onClick={() => { fn?.(); onClose(); }}
          style={{ width: "100%", padding: "14px 22px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,.04)", textAlign: "left", fontSize: 14, color: danger ? "rgba(255,80,80,.75)" : "rgba(255,255,255,.82)", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}
        >
          <span style={{ color: danger ? "rgba(255,80,80,.65)" : t.accent, display: "flex", alignItems: "center", width: 18, flexShrink: 0 }}>{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

function PlaylistPickerSheet({ track, album, userId, t, onClose }) {
  const [playlists, setPlaylists] = useState(() => loadPlaylists(userId));
  const [added, setAdded] = useState(null);

  const trackRef = useMemo(() => ({
    id: track?.id,
    slug: track?.slug,
    title: track?.title,
    artist: album?.artist || "2MRRW",
    cover: album?.cover || album?.coverArt || null,
  }), [track, album]);

  const doAdd = useCallback((playlistId) => {
    if (!userId || !trackRef.slug) return;
    addTrackToPlaylist(userId, playlistId, trackRef);
    setAdded(playlistId);
    setTimeout(onClose, 900);
  }, [userId, trackRef, onClose]);

  const doNew = useCallback(() => {
    if (!userId || !trackRef.slug) return;
    const pl = createPlaylist(userId, { title: album?.title || "New Playlist" });
    addTrackToPlaylist(userId, pl.id, trackRef);
    setPlaylists(loadPlaylists(userId));
    setAdded(pl.id);
    setTimeout(onClose, 900);
  }, [userId, trackRef, album, onClose]);

  return (
    <div className="bsheet" style={{ background: t.dark, paddingBottom: "max(32px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)", maxHeight: "70vh", overflowY: "auto" }}>
      <div className="sheet-hdl" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClose()} />
      <div style={{ padding: "4px 22px 14px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 400, color: "white" }}>Add to Playlist</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".18em", textTransform: "uppercase", color: "rgba(255,255,255,.35)", marginTop: 2 }}>{track?.title}</div>
      </div>
      <button
        type="button"
        onClick={doNew}
        style={{ width: "100%", padding: "14px 22px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left", fontSize: 14, color: t.accent, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
      >
        <span style={{ width: 20, height: 20, borderRadius: "50%", border: `1px solid ${t.p1}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, lineHeight: 1, flexShrink: 0 }}>+</span>
        New Playlist
      </button>
      {playlists.filter(pl => !pl.isSystem).map((pl) => (
        <button
          key={pl.id}
          type="button"
          onClick={() => doAdd(pl.id)}
          style={{ width: "100%", padding: "14px 22px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,.04)", textAlign: "left", fontSize: 13, color: added === pl.id ? t.accent : "rgba(255,255,255,.78)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
        >
          {added === pl.id ? <span style={{ color: t.accent, display: "flex", alignItems: "center" }}><I.Check /></span> : <span style={{ width: 14, display: "inline-block" }} />}
          {pl.title}
        </button>
      ))}
      {playlists.filter(pl => !pl.isSystem).length === 0 && (
        <div style={{ padding: "18px 22px", fontSize: 12, color: "rgba(255,255,255,.3)", textAlign: "center" }}>No playlists yet. Create one above.</div>
      )}
    </div>
  );
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function PlaybackSpeedSheet({ speed, t, onSelect, onClose }) {
  return (
    <div className="bsheet" style={{ background: t.dark, paddingBottom: "max(32px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <div className="sheet-hdl" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClose()} />
      <div style={{ padding: "4px 22px 14px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 400, color: "white" }}>Playback Speed</div>
      </div>
      {SPEED_OPTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => { onSelect(s); onClose(); }}
          style={{ width: "100%", padding: "14px 22px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,.04)", textAlign: "left", fontSize: 14, color: s === speed ? t.accent : "rgba(255,255,255,.8)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <span>{s === 1 ? "Normal" : `${s}×`}</span>
          {s === speed ? <span style={{ color: t.accent, fontSize: 12 }}>✓</span> : null}
        </button>
      ))}
    </div>
  );
}

function QueueSheet({ queue, queueIndex, t, onRemove, onMove, onClear, onSaveAsPlaylist, userId, onClose }) {
  const [tab, setTab] = useState("queue");
  const [history] = useState(() => {
    if (!userId || typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(`2mrrw:qhist:${userId}`) || "[]"); } catch { return []; }
  });

  const nowPlaying = queueIndex >= 0 ? queue[queueIndex] : null;
  const upNext = queueIndex >= 0 ? queue.slice(queueIndex + 1) : queue;

  // Touch drag state
  const dragRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  const ROW_H = 56;

  const handleGripTouch = useCallback((absoluteIdx) => (e) => {
    if (absoluteIdx === queueIndex) return;
    e.stopPropagation();
    dragRef.current = { fromIdx: absoluteIdx, startY: e.touches[0].clientY };
    setDragState({ fromIdx: absoluteIdx, toIdx: absoluteIdx });
  }, [queueIndex]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const deltaY = e.touches[0].clientY - dragRef.current.startY;
      const steps = Math.round(deltaY / ROW_H);
      const toIdx = Math.max(0, Math.min(queue.length - 1, dragRef.current.fromIdx + steps));
      setDragState({ fromIdx: dragRef.current.fromIdx, toIdx });
    };
    const onEnd = () => {
      if (dragRef.current && dragState && dragState.fromIdx !== dragState.toIdx) {
        onMove_?.(dragState.fromIdx, dragState.toIdx);
      }
      dragRef.current = null;
      setDragState(null);
    };
    // intentional: we need onMove to be a different name inside useEffect
    const onMove_ = onMove;
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => { window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
  }, [dragState, queue.length, onMove]);

  const renderQueueRow = (item, absoluteIdx, label) => {
    const isPlaying = absoluteIdx === queueIndex;
    const isDragging = dragState?.fromIdx === absoluteIdx;
    const isTarget = dragState && dragState.toIdx === absoluteIdx && dragState.fromIdx !== absoluteIdx;
    return (
      <div
        key={item.id ?? item.slug ?? absoluteIdx}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 10px 10px",
          borderBottom: isTarget ? `2px solid ${t.p1}` : "1px solid rgba(255,255,255,.04)",
          background: isDragging ? `${t.p1}18` : isPlaying ? `${t.p1}0e` : "transparent",
          opacity: isDragging ? 0.75 : 1,
          transition: isDragging ? "none" : "background .12s",
        }}
      >
        <div
          onTouchStart={handleGripTouch(absoluteIdx)}
          style={{ color: isPlaying ? "rgba(155,93,229,.25)" : "rgba(255,255,255,.2)", cursor: isPlaying ? "default" : "grab", padding: "4px 6px", touchAction: "none", flexShrink: 0 }}
        >
          <I.Grip />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: isPlaying ? 600 : 400, color: isPlaying ? t.accent : "rgba(255,255,255,.82)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,.28)", marginTop: 1 }}>{item.artist}</div>
        </div>
        {label ? <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 7, letterSpacing: ".1em", color: t.accent, flexShrink: 0 }}>{label}</span> : null}
        {isPlaying ? (
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            <div className="eq-b" style={{ background: t.accent }} />
            <div className="eq-b" style={{ background: t.accent }} />
            <div className="eq-b" style={{ background: t.accent }} />
          </div>
        ) : (
          <button type="button" onClick={() => onRemove?.(absoluteIdx)} style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: "rgba(255,255,255,.22)", display: "flex", alignItems: "center", flexShrink: 0 }}>
            <I.Trash />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bsheet" style={{ background: t.dark, paddingBottom: "max(32px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)", maxHeight: "72vh", display: "flex", flexDirection: "column" }}>
      <div className="sheet-hdl" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClose()} />
      <div style={{ padding: "4px 22px 10px", borderBottom: "1px solid rgba(255,255,255,.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 400, color: "white" }}>Queue</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setTab("queue")} style={{ padding: "4px 10px", borderRadius: 12, border: `1px solid ${tab === "queue" ? t.p1 : "rgba(255,255,255,.1)"}`, background: tab === "queue" ? `${t.p1}22` : "transparent", color: tab === "queue" ? t.accent : "rgba(255,255,255,.4)", fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".1em", cursor: "pointer" }}>QUEUE</button>
          <button type="button" onClick={() => setTab("history")} style={{ padding: "4px 10px", borderRadius: 12, border: `1px solid ${tab === "history" ? t.p1 : "rgba(255,255,255,.1)"}`, background: tab === "history" ? `${t.p1}22` : "transparent", color: tab === "history" ? t.accent : "rgba(255,255,255,.4)", fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".1em", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><I.History /> HISTORY</button>
        </div>
      </div>

      {tab === "queue" ? (
        <>
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {nowPlaying ? (
              <>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".2em", color: "rgba(255,255,255,.3)", padding: "10px 22px 4px" }}>NOW PLAYING</div>
                {renderQueueRow(nowPlaying, queueIndex, "NOW")}
              </>
            ) : null}
            {upNext.length > 0 ? (
              <>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".2em", color: "rgba(255,255,255,.3)", padding: "10px 22px 4px" }}>UP NEXT · {upNext.length} TRACKS</div>
                {upNext.map((item, i) => renderQueueRow(item, queueIndex + 1 + i, null))}
              </>
            ) : null}
            {!queue.length ? <div style={{ padding: "28px 22px", fontSize: 12, color: "rgba(255,255,255,.3)", textAlign: "center" }}>Queue is empty</div> : null}
          </div>
          <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", gap: 0 }}>
            {upNext.length > 0 ? (
              <button type="button" onClick={() => { onClear?.(); }} style={{ flex: 1, padding: "12px 16px", background: "transparent", border: "none", borderRight: "1px solid rgba(255,255,255,.06)", color: "rgba(255,100,100,.65)", fontSize: 12, cursor: "pointer" }}>
                Clear Queue
              </button>
            ) : null}
            {queue.length > 1 && userId ? (
              <button type="button" onClick={() => { onSaveAsPlaylist?.(); onClose(); }} style={{ flex: 1, padding: "12px 16px", background: "transparent", border: "none", color: t.accent, fontSize: 12, cursor: "pointer" }}>
                Save as Playlist
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          {history.length ? history.map((h, i) => (
            <div key={h.id ?? h.slug ?? i} style={{ padding: "10px 22px", borderBottom: "1px solid rgba(255,255,255,.04)", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,.2)", flexShrink: 0, minWidth: 16 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.title}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,255,255,.28)", marginTop: 1 }}>{h.artist}</div>
              </div>
            </div>
          )) : (
            <div style={{ padding: "28px 22px", fontSize: 12, color: "rgba(255,255,255,.3)", textAlign: "center" }}>Nothing played yet</div>
          )}
        </div>
      )}
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
  open = true,
  persistent = false,
}) {
  const coverSrc = trackCoverSrc(track || {});
  const isVideo = (track?.coverArtType || track?.coverType) === "video";
  const palette = useCoverPalette(coverSrc, track?.coverArtType || track?.coverType || "image");
  const t = useMemo(() => buildTheme(palette), [palette]);
  const vars = useMemo(() => themeVars(t), [t]);

  const isPreview = access !== "full";
  const fullDur = parseDurSec(track) || 222;
  const duration = isPreview ? PREVIEW_CAP_SEC : fullDur || 222;

  const {
    state: { isPlaying, currentTime, duration: engineDuration, shuffle, repeatMode, sleepTimerEndsAt, sleepAfterCurrentTrack },
    toggle,
    seek,
    playNext,
    playPrevious,
    seekBack,
    seekForward,
    toggleShuffle,
    toggleRepeat,
    setSleepTimer,
  } = useMediaEngine({ active: open });

  const { mounted, closing, setClosing } = useModalAnim(open, persistent);
  const prefersReducedMotion = useReducedMotion();
  const beat = useBeat(open && isPlaying);
  const [sheet, setSheet] = useState(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [coverVideoFailed, setCoverVideoFailed] = useState(false);
  const closeTimerRef = useRef(null);

  const renderedOpen = open || closing;
  usePlayerBodyState({ modalOpen: renderedOpen });

  useEffect(() => {
    if (!renderedOpen) return undefined;
    registerModal("immersive-preview-modal");
    return () => unregisterModal("immersive-preview-modal");
  }, [renderedOpen]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    []
  );

  const engineDur = engineDuration > 0 ? engineDuration : duration;
  const displayDuration = isPreview ? PREVIEW_CAP_SEC : engineDur;
  const displayCurrent = isPreview ? Math.min(currentTime, PREVIEW_CAP_SEC) : currentTime;

  const release = releaseDetail || track;
  const lyricsText = release?.lyrics || track?.lyrics || "";
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
      creditRows.slice(0, 3).forEach((row) => {
        if (row?.label && row?.value) rows.push([row.label.toUpperCase(), row.value]);
      });
    }
    if (!rows.length) {
      rows.push(["ARTIST", track?.artist || "2MRRW"], ["TYPE", track?.type || "Single"]);
    }
    return rows;
  }, [editorial, track, creditRows, fullDur]);

  const close = useCallback(() => {
    if (closing || !renderedOpen) return;
    setSheet(null);
    if (persistent) {
      onClose?.();
      return;
    }
    setClosing(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose?.();
    }, prefersReducedMotion ? 0 : 340);
  }, [closing, onClose, persistent, prefersReducedMotion, renderedOpen, setClosing]);

  const singleCoverRef = useRef(null);
  const { handlers: singleCoverGesture } = useArtworkGesture({
    slug: track?.slug || "",
    elementRef: singleCoverRef,
  });

  const isVisible = mounted && !closing;
  const hiddenSheetTransform = "translate3d(0,100%,0)";
  const priceLabel = track?.price || track?.priceLabel || "";
  const entitlementAccountState = useEntitlementAccountState();
  const showSubscribeCta = useMemo(
    () => resolveSubscriptionEntitlements(entitlementAccountState).showSubscribe,
    [entitlementAccountState]
  );

  return (
    <div
      data-persistent-modal={persistent ? "true" : undefined}
      role={renderedOpen ? "dialog" : undefined}
      aria-modal={renderedOpen ? "true" : undefined}
      aria-hidden={!renderedOpen}
      inert={!renderedOpen ? true : undefined}
      aria-label={`${track?.title || "Release"} details`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "flex-end",
        background: "transparent",
        visibility: renderedOpen ? "visible" : "hidden",
        pointerEvents: renderedOpen ? "auto" : "none",
        transition: persistent
          ? renderedOpen
            ? "visibility 0s"
            : `visibility 0s linear ${prefersReducedMotion ? 0 : 340}ms`
          : undefined,
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: isVisible ? 1 : 0,
          background: "rgba(0,0,0,.88)",
          backdropFilter: "blur(7px)",
          WebkitBackdropFilter: "blur(7px)",
          transition: prefersReducedMotion ? "none" : "opacity .35s ease",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 430,
          margin: "0 auto",
          height: "min(calc(100dvh - env(safe-area-inset-top) - 8px), 880px)",
          borderRadius: "22px 22px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: t.dark,
          boxShadow: `0 0 70px ${t.glowDim}, 0 -10px 60px rgba(0,0,0,.85)`,
          willChange: mounted && !closing ? "auto" : "transform",
          backfaceVisibility: "hidden",
          transform: mounted && !closing ? "translate3d(0,0,0) scale(1)" : hiddenSheetTransform,
          transition: prefersReducedMotion
            ? "none"
            : closing
              ? "transform .34s cubic-bezier(.55,0,1,.45)"
              : "transform .48s cubic-bezier(.16,1,.3,1)",
          ...vars,
        }}
      >
        <div
          ref={singleCoverRef}
          style={{ flex: "0 0 65%", position: "relative", overflow: "hidden" }}
          onPointerDown={singleCoverGesture.onPointerDown}
          onPointerMove={singleCoverGesture.onPointerMove}
          onPointerUp={singleCoverGesture.onPointerUp}
          onPointerCancel={singleCoverGesture.onPointerCancel}
          onLostPointerCapture={singleCoverGesture.onLostPointerCapture}
        >
          {/* Full-bleed cover art — jpg or mp4 loop */}
          {isVideo && !coverVideoFailed ? (
            <PersistentCoverVideo
              active={renderedOpen}
              src={coverSrc}
              loop
              muted
              playsInline
              preload="auto"
              onError={() => setCoverVideoFailed(true)}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : coverSrc ? (
            <img
              src={coverSrc}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg,${t.bg[0]},${t.bg[1]},${t.bg[2]})` }} />
          )}
          {/* Palette-tinted ambient overlay — color from cover art */}
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 28% 18%,${t.p1}30,transparent 58%)`, pointerEvents: "none" }} />
          {/* Bottom gradient — controls legibility */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              pointerEvents: "none",
              background: "linear-gradient(to top,rgba(0,0,0,.97) 0%,rgba(0,0,0,.15) 42%,transparent 62%)",
            }}
          />
          <div style={{ position: "absolute", top: 14, left: 0, right: 0, zIndex: 30, display: "flex", justifyContent: "center" }}>
            <div className="drag-pill" onClick={close} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && close()} onPointerDown={(e) => e.stopPropagation()} />
          </div>
          <div style={{ position: "absolute", top: 12, right: 14, zIndex: 30 }}>
            <Badge access={access} t={t} />
          </div>
          {isPreview ? (
            <div style={{ position: "absolute", bottom: 118, left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "center" }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".22em", padding: "4px 12px", borderRadius: 20, background: "rgba(0,0,0,.65)", border: "1px solid rgba(255,255,255,.12)", color: "rgba(255,255,255,.45)" }}>
                30 SEC PREVIEW
              </div>
            </div>
          ) : null}
          {/* Credits + Lyrics pills */}
          <div style={{ position: "absolute", bottom: 108, left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => { setLyricsOpen(false); setSheet("credits"); }}
              style={{
                background: "rgba(0,0,0,.58)",
                border: `1px solid ${t.p1}50`,
                color: t.accent,
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: ".22em",
                textTransform: "uppercase",
                padding: "7px 20px",
                borderRadius: 20,
                cursor: "pointer",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              Credits
            </button>
            <button
              type="button"
              onClick={() => { setSheet(null); setLyricsOpen(true); }}
              style={{
                background: "rgba(0,0,0,.58)",
                border: `1px solid ${t.p1}50`,
                color: t.accent,
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: ".22em",
                textTransform: "uppercase",
                padding: "7px 20px",
                borderRadius: 20,
                cursor: "pointer",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              Lyrics
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
            onPrev={playPrevious}
            onNext={playNext}
            onSkipBack={isPreview ? undefined : seekBack}
            onSkipFwd={isPreview ? undefined : seekForward}
            onToggleShuffle={toggleShuffle}
            shuffleOn={shuffle}
            onToggleRepeat={toggleRepeat}
            repeatMode={repeatMode}
          />
          {/* Lyrics overlay — sits above cover art, below controls */}
          <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: lyricsOpen ? "auto" : "none" }}>
            <GlyphLyricsPanel open={lyricsOpen} lrcText={lyricsText} onClose={() => setLyricsOpen(false)} isMobile />
          </div>
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
                {showSubscribeCta ? (
                  <Link href="/subscribe" className="icon-btn" style={{ color: t.accent, filter: `drop-shadow(0 0 6px ${t.glow})` }}>
                    <I.Sub s={28} />
                  </Link>
                ) : null}
                <button type="button" className="icon-btn" style={{ color: "rgba(255,255,255,.38)" }} onClick={() => (onGift ? onGift() : setSheet("share"))}>
                  <I.Plus s={26} />
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 40 }}>
                <button
                  type="button"
                  className="icon-btn col-glow"
                  style={{ color: t.accent, "--glow": t.glow }}
                  onClick={() => onLibraryChange?.()}
                >
                  <I.Coll s={30} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Sleep timer"
                  style={{ color: (sleepTimerEndsAt || sleepAfterCurrentTrack) ? t.accent : "rgba(255,255,255,.38)", filter: (sleepTimerEndsAt || sleepAfterCurrentTrack) ? `drop-shadow(0 0 5px ${t.glow})` : "none" }}
                  onClick={() => setSheet("sleep")}
                >
                  <I.Moon />
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
        {sheet === "credits" ? (
          <ViewMoreSheet title="Credits" sub={`${track?.title} · ${track?.artist}`} t={t} rows={viewMoreRows} onClose={() => setSheet(null)} />
        ) : null}
        {sheet === "sleep" ? (
          <SleepTimerSheet t={t} sleepTimerEndsAt={sleepTimerEndsAt} sleepAfterCurrentTrack={sleepAfterCurrentTrack} setSleepTimer={setSleepTimer} onClose={() => setSheet(null)} />
        ) : null}
      </div>
    </div>
  );
}

function AlbumModalView({
  album,
  access = "preview",
  open = true,
  persistent = false,
  onClose,
  onPlayTrackAtIndex,
  otherReleases,
  onReleaseClick,
}) {
  const coverSrc = trackCoverSrc(album);
  const isVideo = (album?.coverArtType || album?.coverType) === "video";
  const palette = useCoverPalette(coverSrc, album?.coverArtType || album?.coverType || "image");
  const t = useMemo(() => buildTheme(palette), [palette]);
  const vars = useMemo(() => themeVars(t), [t]);
  const entitlementAccountState = useEntitlementAccountState();

  // Memoized so `tracks` is referentially stable between renders when the album data hasn't changed.
  // Without this, a new array is created on every render, causing dependents to fire unnecessarily.
  const tracks = useMemo(
    () => (Array.isArray(album?.tracks) ? album.tracks.filter(Boolean) : []),
    [album]
  );
  const totalRuntimeSec = useMemo(() => tracks.reduce((sum, tr) => sum + parseDurSec(tr), 0), [tracks]);
  const totalRuntimeLabel = useMemo(() => {
    if (!totalRuntimeSec) return "";
    const m = Math.floor(totalRuntimeSec / 60);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  }, [totalRuntimeSec]);
  const { mounted, closing, setClosing } = useModalAnim(open, persistent);
  const prefersReducedMotion = useReducedMotion();
  // Store only the ID — derive the full track object. This decouples selection identity
  // from list referencing and eliminates the need for an effect to sync selection when tracks changes.
  const [activeTrackId, setActiveTrackId] = useState(() => tracks[0]?.id ?? null);
  const activeTrack = useMemo(() => {
    if (!tracks.length) return null;
    if (activeTrackId != null) {
      const found = tracks.find((tr) => tr?.id === activeTrackId);
      if (found) return found;
    }
    return tracks[0] ?? null;
  }, [tracks, activeTrackId]);
  // Adjust selection when tracks list changes — React "adjust state when prop changes" pattern.
  // Runs during render (not in an effect), causes one extra synchronous re-render of this
  // component only, no cascading renders. `tracks` is stable (useMemo above), so this fires
  // only when the album's track list genuinely changes.
  const [syncedTracks, setSyncedTracks] = useState(tracks);
  if (syncedTracks !== tracks) {
    setSyncedTracks(tracks);
    setActiveTrackId(
      !tracks.length
        ? null
        : (activeTrackId != null && tracks.some((tr) => tr?.id === activeTrackId))
          ? activeTrackId
          : (tracks[0]?.id ?? null)
    );
  }
  const [sheet, setSheet] = useState(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsFullscreen, setLyricsFullscreen] = useState(false);
  const [albumCoverVideoFailed, setAlbumCoverVideoFailed] = useState(false);
  const [playbackNotice, setPlaybackNotice] = useState(null);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const [downloadStates, setDownloadStates] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [trackMenu, setTrackMenu] = useState(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const swipeRef = useRef({});
  const albumCoverRef = useRef(null);
  const closeTimerRef = useRef(null);

  const {
    state: { isPlaying, currentTime, duration: engineDuration, currentTrack: engineTrack, shuffle, repeatMode, sleepTimerEndsAt, sleepAfterCurrentTrack, queue: engineQueue, queueIndex: engineQueueIndex },
    toggle,
    seek,
    playNext,
    playPrevious,
    seekBack,
    seekForward,
    toggleShuffle,
    toggleRepeat,
    setSleepTimer,
    enqueueTrack,
    removeFromQueue,
    moveInQueue,
    setPlaybackRate,
  } = useMediaEngine({ active: open });
  const { setShuffle } = useAudioPlayer();
  const beat = useBeat(open && isPlaying);

  const renderedOpen = open || closing;
  usePlayerBodyState({ modalOpen: renderedOpen });

  useEffect(() => {
    if (!renderedOpen) return undefined;
    registerModal("immersive-album-modal");
    return () => unregisterModal("immersive-album-modal");
  }, [renderedOpen]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    []
  );

  // Sync tracklist highlight when the engine auto-advances to the next track.
  // "adjust state when external source changes" render-time pattern — causes one extra
  // synchronous re-render of this component only; no cascading renders, no stale effect.
  // Guards: only fires when engine is on this album and index is valid and changed.
  const engineIsOnThisAlbum = engineTrack?.metadata?.albumSlug === album?.slug;
  const engineTIdx =
    engineIsOnThisAlbum && Number.isFinite(engineTrack?.metadata?.trackIndex)
      ? engineTrack.metadata.trackIndex
      : -1;
  const engineActiveId =
    engineTIdx >= 0 && engineTIdx < tracks.length ? (tracks[engineTIdx]?.id ?? null) : null;
  const [prevEngineActiveId, setPrevEngineActiveId] = useState(engineActiveId);
  if (prevEngineActiveId !== engineActiveId && engineActiveId != null) {
    setPrevEngineActiveId(engineActiveId);
    setActiveTrackId(engineActiveId);
  }

  const { handlers: albumCoverGesture } = useArtworkGesture({
    slug: engineTrack?.slug || "",
    elementRef: albumCoverRef,
    disabled: !engineTrack || engineTrack?.metadata?.albumSlug !== album?.slug,
  });

  const isPreview = access !== "full";
  const trackLocked = useCallback((tr) => isPreview && !tr?.free, [isPreview]);
  const trackDur = (tr) => (isPreview && !tr?.free ? PREVIEW_CAP_SEC : parseDurSec(tr) || 180);
  const activeDur = activeTrack ? trackDur(activeTrack) : PREVIEW_CAP_SEC;
  const engineDur = engineDuration > 0 ? engineDuration : activeDur;
  const displayDuration = isPreview && activeTrack && !activeTrack?.free ? PREVIEW_CAP_SEC : engineDur;
  const displayCurrent =
    isPreview && activeTrack && !activeTrack?.free ? Math.min(currentTime, PREVIEW_CAP_SEC) : currentTime;
  const close = useCallback(() => {
    if (closing || !renderedOpen) return;
    setSheet(null);
    if (persistent) {
      onClose?.();
      return;
    }
    setClosing(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose?.();
    }, prefersReducedMotion ? 0 : 340);
  }, [closing, onClose, persistent, prefersReducedMotion, renderedOpen, setClosing]);

  const showPlaybackNotice = useCallback((message) => {
    if (!message) return;
    setPlaybackNotice(message);
  }, []);

  useEffect(() => {
    if (!playbackNotice) return undefined;
    const timer = setTimeout(() => setPlaybackNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [playbackNotice]);

  const handleTrack = useCallback(
    async (tr) => {
      const idx = tracks.indexOf(tr);
      const albumSlug = album?.slug || "";
      const trackSlug = tr?.slug || String(tr?.id || "");
      const queueId = albumSlug && trackSlug ? `${albumSlug}:${trackSlug}` : tr?.id || trackSlug;
      const modalPlaybackItem = {
        id: queueId,
        slug: albumSlug || trackSlug,
        metadata: {
          albumSlug,
          trackSlug,
          trackIndex: idx >= 0 ? idx : undefined,
        },
      };
      const engineItem = engineTrack
        ? { id: engineTrack.id, slug: engineTrack.slug, metadata: engineTrack.metadata }
        : getPagePlaybackActionsBridge()?.currentTrack;

      // Determine if this tap targets the already-active track (toggle intent).
      // activeTrack.id is a DB id; queueId is composite albumSlug:trackSlug — check both.
      // The direct tr.id check is safe here because Fix 2 reverts activeTrack on failed playback,
      // so stale-activeTrack false positives are impossible.
      // Engine is the sole source of truth: only toggle if the engine is actually
      // playing this exact track. Comparing UI activeTrack state causes false positives
      // when the highlight is stale (optimistic update in-flight or engine auto-advanced).
      const engineMatches = engineItem && isSamePlaybackTrack(engineItem, modalPlaybackItem);
      const sameTrack = engineMatches;

      if (sameTrack) {
        toggle();
        return;
      }

      // Tapping a specific track overrides shuffle — same behavior as Spotify/Apple Music.
      setShuffle(false);

      // Optimistic UI: highlight the tapped track immediately.
      const prevActiveTrackId = activeTrackId;
      setActiveTrackId(tr?.id ?? null);

      if (idx >= 0) {
        // Pass the live React entitlement state so the bridge uses the freshest permissions,
        // not the potentially-stale page auth ref snapshot.
        const ok = await onPlayTrackAtIndex?.(idx, entitlementAccountState);
        if (ok === false) {
          setActiveTrackId(prevActiveTrackId); // revert optimistic highlight on failure
          const queueTracks = albumTracksForPlayback(album, entitlementAccountState, "album_modal");
          const blocked =
            getPagePlaybackActionsBridge()?.error ||
            describeAlbumQueuePlaybackFailure(queueTracks, album, entitlementAccountState) ||
            "Couldn't start playback. Try again.";
          showPlaybackNotice(blocked);
        }
        return;
      }
      showPlaybackNotice("This track isn't in the playback queue yet.");
    },
    [
      activeTrackId,
      album,
      engineTrack,
      entitlementAccountState,
      onPlayTrackAtIndex,
      setShuffle,
      showPlaybackNotice,
      toggle,
      tracks,
    ]
  );

  const handlePlayAll = useCallback(async () => {
    if (!tracks.length) return;
    setShuffle(false);
    setActiveTrackId(tracks[0]?.id ?? null);
    const ok = await onPlayTrackAtIndex?.(0, entitlementAccountState);
    if (ok === false) {
      setActiveTrackId(null);
      const playbackTracks = albumTracksForPlayback(album, entitlementAccountState, "album_modal");
      showPlaybackNotice(
        describeAlbumQueuePlaybackFailure(playbackTracks, album, entitlementAccountState) ||
          "Couldn't start playback. Try again."
      );
    }
  }, [tracks, album, setShuffle, onPlayTrackAtIndex, entitlementAccountState, showPlaybackNotice]);

  const handleShufflePlay = useCallback(async () => {
    if (!tracks.length) return;
    setShuffle(true);
    // No optimistic highlight — the engine may resolve to a different track than
    // the raw index (unavailable tracks are skipped). The engine-sync useEffect
    // will update activeTrack once playback actually starts.
    const idx = Math.floor(Math.random() * tracks.length);
    const ok = await onPlayTrackAtIndex?.(idx, entitlementAccountState);
    if (ok === false) {
      const playbackTracks = albumTracksForPlayback(album, entitlementAccountState, "album_modal");
      showPlaybackNotice(
        describeAlbumQueuePlaybackFailure(playbackTracks, album, entitlementAccountState) ||
          "Couldn't start playback. Try again."
      );
    }
  }, [tracks, album, setShuffle, onPlayTrackAtIndex, entitlementAccountState, showPlaybackNotice]);

  const userId = entitlementAccountState?.user?.id ?? null;

  const handleSaveToLibrary = useCallback(async () => {
    if (!album?.slug || savedToLibrary || isPreview) return;
    setSavedToLibrary(true);
    try { await postLibraryAdd(album.slug); } catch { /* best effort */ }
  }, [album, savedToLibrary, isPreview]);

  const handleDownload = useCallback(async (tr, e) => {
    e?.stopPropagation();
    if (!userId || !album?.slug) return;
    const slug = tr?.slug;
    if (!slug || typeof slug !== "string" || /^\d+$/.test(slug)) return;
    if (downloadStates[slug] === "done" || typeof downloadStates[slug] === "number") return;
    setDownloadStates((prev) => ({ ...prev, [slug]: 0 }));
    setDownloadProgress((prev) => ({ ...prev, [slug]: 0 }));
    try {
      await queueOfflineDownload(userId, tr, {
        streamUrl: `/api/library/stream?slug=${encodeURIComponent(album.slug)}&trackSlug=${encodeURIComponent(slug)}`,
        onProgress: (pct) => setDownloadProgress((prev) => ({ ...prev, [slug]: pct })),
      });
      setDownloadStates((prev) => ({ ...prev, [slug]: "done" }));
      setDownloadProgress((prev) => ({ ...prev, [slug]: 100 }));
    } catch {
      setDownloadStates((prev) => ({ ...prev, [slug]: null }));
      setDownloadProgress((prev) => ({ ...prev, [slug]: 0 }));
    }
  }, [album, downloadStates, userId]);

  const handleEnqueue = useCallback((tr, { playNext: insertNext = false } = {}) => {
    if (!enqueueTrack || !album?.slug) return;
    const idx = tracks.findIndex((t) => t && tr && String(t.id) === String(tr.id));
    const allPlayback = albumTracksForPlayback(album, entitlementAccountState, "album_modal", getCatalogSurfaceRef().catalogPlaybackLookup);
    const playbackTrack = idx >= 0 ? allPlayback[idx] : null;
    if (playbackTrack?.src) enqueueTrack(playbackTrack, { playNext: insertNext });
  }, [album, tracks, entitlementAccountState, enqueueTrack]);

  const handleDownloadAll = useCallback(async () => {
    if (!userId || !album?.slug || isPreview) return;
    const downloadable = tracks.filter(
      (tr) => tr?.slug && typeof tr.slug === "string" && !/^\d+$/.test(tr.slug) && downloadStates[tr.slug] !== "done"
    );
    for (const tr of downloadable) {
      if (typeof downloadStates[tr.slug] === "number") continue;
      setDownloadStates((prev) => ({ ...prev, [tr.slug]: 0 }));
      try {
        await queueOfflineDownload(userId, tr, {
          streamUrl: `/api/library/stream?slug=${encodeURIComponent(album.slug)}&trackSlug=${encodeURIComponent(tr.slug)}`,
          onProgress: (pct) => setDownloadProgress((prev) => ({ ...prev, [tr.slug]: pct })),
        });
        setDownloadStates((prev) => ({ ...prev, [tr.slug]: "done" }));
      } catch {
        setDownloadStates((prev) => ({ ...prev, [tr.slug]: null }));
      }
    }
  }, [album, downloadStates, isPreview, tracks, userId]);

  const handleRemoveFromDownloads = useCallback((tr) => {
    if (!userId || !tr?.slug) return;
    removeOfflineCache(userId, tr.slug);
    setDownloadStates((prev) => ({ ...prev, [tr.slug]: null }));
    setDownloadProgress((prev) => ({ ...prev, [tr.slug]: 0 }));
  }, [userId]);

  const handleSaveTrackToLibrary = useCallback(async (tr) => {
    if (!tr?.slug || isPreview) return;
    try { await postLibraryAdd(tr.slug); } catch { /* best effort */ }
  }, [isPreview]);

  const handleStartRadio = useCallback((tr) => {
    if (!otherReleases?.length || !enqueueTrack) return;
    // Queue first track from each other release as a radio mix (up to 6)
    const radioTracks = otherReleases
      .filter((r) => Array.isArray(r.tracks) && r.tracks.length > 0)
      .slice(0, 6)
      .map((r) => {
        const t0 = r.tracks[0];
        const allPlayback = albumTracksForPlayback(r, entitlementAccountState, "radio", getCatalogSurfaceRef().catalogPlaybackLookup);
        return allPlayback[0];
      })
      .filter(Boolean);
    radioTracks.forEach((rt) => { if (rt?.src) enqueueTrack(rt, { playNext: false }); });
    showPlaybackNotice(`Radio started · ${radioTracks.length} tracks queued`);
  }, [otherReleases, enqueueTrack, entitlementAccountState, showPlaybackNotice]);

  const handleGoToArtist = useCallback(() => {
    close();
  }, [close]);

  const handleClearQueue = useCallback(() => {
    if (!engineQueue?.length || !removeFromQueue) return;
    // Remove all tracks after current (don't remove currently playing)
    const afterCurrent = engineQueue.length - 1 - engineQueueIndex;
    for (let i = 0; i < afterCurrent; i++) {
      removeFromQueue(engineQueue.length - 1 - i);
    }
  }, [engineQueue, engineQueueIndex, removeFromQueue]);

  const handleSaveQueueAsPlaylist = useCallback(() => {
    if (!userId || !engineQueue?.length) return;
    const pl = createPlaylist(userId, { title: `${album?.title || "Queue"} Mix` });
    engineQueue.forEach((q) => {
      addTrackToPlaylist(userId, pl.id, {
        id: q.id, slug: q.slug, title: q.title, artist: q.artist, cover: q.artwork || null,
      });
    });
    showPlaybackNotice(`Saved to "${pl.title}"`);
  }, [userId, engineQueue, album?.title, showPlaybackNotice]);

  const handleSpeedChange = useCallback((rate) => {
    setPlaybackSpeed(rate);
    setPlaybackRate?.(rate);
  }, [setPlaybackRate]);

  const isVisible = mounted && !closing;
  const hiddenSheetTransform = "translate3d(0,100%,0)";

  return (
    <div
      data-persistent-modal={persistent ? "true" : undefined}
      role={renderedOpen ? "dialog" : undefined}
      aria-modal={renderedOpen ? "true" : undefined}
      aria-hidden={!renderedOpen}
      inert={!renderedOpen ? true : undefined}
      aria-label={`${album?.title || "Release"} details`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "flex-end",
        background: "transparent",
        visibility: renderedOpen ? "visible" : "hidden",
        pointerEvents: renderedOpen ? "auto" : "none",
        transition: persistent
          ? renderedOpen
            ? "visibility 0s"
            : `visibility 0s linear ${prefersReducedMotion ? 0 : 340}ms`
          : undefined,
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: isVisible ? 1 : 0,
          background: "rgba(0,0,0,.88)",
          backdropFilter: "blur(7px)",
          WebkitBackdropFilter: "blur(7px)",
          transition: prefersReducedMotion ? "none" : "opacity .35s ease",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 430,
          margin: "0 auto",
          height: "min(calc(100dvh - env(safe-area-inset-top) - 8px), 880px)",
          borderRadius: "22px 22px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: t.dark,
          boxShadow: `0 0 70px ${t.glowDim}, 0 -10px 60px rgba(0,0,0,.85)`,
          willChange: mounted && !closing ? "auto" : "transform",
          backfaceVisibility: "hidden",
          transform: mounted && !closing ? "translate3d(0,0,0) scale(1)" : hiddenSheetTransform,
          transition: prefersReducedMotion
            ? "none"
            : closing
              ? "transform .34s cubic-bezier(.55,0,1,.45)"
              : "transform .48s cubic-bezier(.16,1,.3,1)",
          ...vars,
        }}
      >
        <div
          ref={albumCoverRef}
          style={{ flex: "0 0 65%", position: "relative", overflow: "hidden" }}
          onPointerDown={albumCoverGesture.onPointerDown}
          onPointerMove={albumCoverGesture.onPointerMove}
          onPointerUp={albumCoverGesture.onPointerUp}
          onPointerCancel={albumCoverGesture.onPointerCancel}
          onLostPointerCapture={albumCoverGesture.onLostPointerCapture}
        >
          {/* Full-bleed cover art */}
          {isVideo && !albumCoverVideoFailed ? (
            <PersistentCoverVideo
              active={renderedOpen}
              src={coverSrc}
              loop
              muted
              playsInline
              preload="auto"
              onError={() => setAlbumCoverVideoFailed(true)}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : coverSrc ? (
            <img
              src={coverSrc}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg,${t.bg[0]},${t.bg[1]},${t.bg[2]})` }} />
          )}
          {/* Palette ambient overlay */}
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 28% 18%,${t.p1}30,transparent 58%)`, pointerEvents: "none" }} />
          {/* Bottom fade */}
          <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: "linear-gradient(to top,rgba(0,0,0,.97) 0%,rgba(0,0,0,.15) 42%,transparent 62%)" }} />
          <div style={{ position: "absolute", top: 14, left: 0, right: 0, zIndex: 30, display: "flex", justifyContent: "center" }}>
            <div className="drag-pill" onClick={close} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && close()} onPointerDown={(e) => e.stopPropagation()} />
          </div>
          <div style={{ position: "absolute", top: 12, right: 14, zIndex: 30 }}>
            <Badge access={access} t={t} />
          </div>
          {/* Now playing track title — overlaid on art, above pills */}
          {activeTrack && (
            <div style={{ position: "absolute", bottom: 152, left: 0, right: 0, zIndex: 10, padding: "0 22px", pointerEvents: "none" }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".22em", textTransform: "uppercase", color: t.accent, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                {isPlaying ? (
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
                    <div className="eq-b" style={{ background: t.accent }} />
                    <div className="eq-b" style={{ background: t.accent }} />
                    <div className="eq-b" style={{ background: t.accent }} />
                  </div>
                ) : null}
                {isPlaying ? "Now Playing" : "Selected"}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 8px rgba(0,0,0,.9)" }}>
                {activeTrack.title}
              </div>
            </div>
          )}
          {/* Credits + Lyrics pills */}
          <div style={{ position: "absolute", bottom: 108, left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => { setLyricsOpen(false); setSheet("credits"); }}
              style={{ background: "rgba(0,0,0,.58)", border: `1px solid ${t.p1}50`, color: t.accent, fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".22em", textTransform: "uppercase", padding: "7px 20px", borderRadius: 20, cursor: "pointer", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
            >
              Credits
            </button>
            <button
              type="button"
              onClick={() => { setSheet(null); setLyricsOpen(true); }}
              style={{ background: "rgba(0,0,0,.58)", border: `1px solid ${t.p1}50`, color: t.accent, fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".22em", textTransform: "uppercase", padding: "7px 20px", borderRadius: 20, cursor: "pointer", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
            >
              Lyrics
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
            onPrev={playPrevious}
            onNext={playNext}
            onSkipBack={isPreview && activeTrack && !activeTrack?.free ? undefined : seekBack}
            onSkipFwd={isPreview && activeTrack && !activeTrack?.free ? undefined : seekForward}
            onToggleShuffle={toggleShuffle}
            shuffleOn={shuffle}
            onToggleRepeat={toggleRepeat}
            repeatMode={repeatMode}
          />
          {/* Lyrics overlay — fullscreen version portals to fixed overlay via GlyphLyricsPanel */}
          <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: lyricsOpen && !lyricsFullscreen ? "auto" : "none" }}>
            <GlyphLyricsPanel
              open={lyricsOpen}
              lrcText={activeTrack?.lyrics || album?.lyrics || ""}
              onClose={() => { setLyricsOpen(false); setLyricsFullscreen(false); }}
              onSeek={isPreview && activeTrack && !activeTrack?.free ? undefined : seek}
              isMobile
              fullscreen={lyricsFullscreen}
              onFullscreenChange={setLyricsFullscreen}
              albumTitle={album?.title}
              artist={album?.artist}
              accentColor={t.accent}
            />
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: t.dark, ...vars }}>
          <div style={{ flexShrink: 0, padding: "14px 20px 10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
            <div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".26em", textTransform: "uppercase", color: t.accent }}>
                {album?.type || "Album"} · {album?.year || ""}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 500, color: "white", lineHeight: 1.1, marginTop: 2 }}>{album?.title}</div>
              <div style={{ fontSize: 11, fontWeight: 300, color: "rgba(255,255,255,.38)", marginTop: 2 }}>
                {album?.artist} · {tracks.length} tracks{totalRuntimeLabel ? ` · ${totalRuntimeLabel}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-end", flexShrink: 0 }}>
              {isPreview && album?.price ? (
                <button type="button" style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${t.p1}`, background: t.glowDim, fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".15em", cursor: "pointer", color: t.accent }}>
                  {album.price} · Acquire
                </button>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!isPreview ? (
                  <button
                    type="button"
                    aria-label={savedToLibrary ? "Saved to library" : "Save to library"}
                    onClick={handleSaveToLibrary}
                    style={{ background: "none", border: "none", padding: 4, cursor: savedToLibrary ? "default" : "pointer", color: savedToLibrary ? t.accent : "rgba(255,255,255,.38)", filter: savedToLibrary ? `drop-shadow(0 0 5px ${t.glow})` : "none", display: "flex", alignItems: "center" }}
                  >
                    {savedToLibrary ? <I.HeartFill /> : <I.HeartOut />}
                  </button>
                ) : null}
                {!isPreview ? (
                  <button
                    type="button"
                    aria-label="Download all tracks"
                    onClick={handleDownloadAll}
                    style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: "rgba(255,255,255,.38)", display: "flex", alignItems: "center" }}
                  >
                    <I.DownloadAll />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="View queue"
                  onClick={() => setSheet("queue")}
                  style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: "rgba(255,255,255,.38)", display: "flex", alignItems: "center" }}
                >
                  <I.Queue />
                </button>
                <button
                  type="button"
                  aria-label="Playback speed"
                  onClick={() => setSheet("speed")}
                  style={{ background: "none", border: "none", padding: "2px 5px", cursor: "pointer", color: playbackSpeed !== 1 ? t.accent : "rgba(255,255,255,.38)", fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".06em", borderRadius: 8, border: `1px solid ${playbackSpeed !== 1 ? t.p1 + "66" : "transparent"}` }}
                >
                  {playbackSpeed === 1 ? "1×" : `${playbackSpeed}×`}
                </button>
                <button
                  type="button"
                  aria-label="Sleep timer"
                  onClick={() => setSheet("sleep")}
                  style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: (sleepTimerEndsAt || sleepAfterCurrentTrack) ? t.accent : "rgba(255,255,255,.38)", filter: (sleepTimerEndsAt || sleepAfterCurrentTrack) ? `drop-shadow(0 0 5px ${t.glow})` : "none", display: "flex", alignItems: "center" }}
                >
                  <I.Moon />
                </button>
                <button type="button" onClick={() => setSheet("share")} style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", fontSize: 10, color: "rgba(255,255,255,.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  <I.Plus s={12} /> Share
                </button>
              </div>
            </div>
          </div>

          <div style={{ flexShrink: 0, display: "flex", gap: 8, padding: "10px 20px 4px" }}>
            <button
              type="button"
              aria-label="Play all tracks from the beginning"
              onClick={handlePlayAll}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 22,
                border: "none",
                background: t.p1,
                color: "rgba(0,0,0,.9)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".08em",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                boxShadow: `0 0 14px ${t.glowDim}`,
              }}
            >
              <I.TrPlay />
              PLAY ALL
            </button>
            <button
              type="button"
              aria-label="Shuffle play all tracks"
              onClick={handleShufflePlay}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 22,
                border: `1px solid ${t.p1}55`,
                background: "rgba(255,255,255,.05)",
                color: t.accent,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".08em",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <I.Shuffle />
              SHUFFLE
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
            {!tracks.length ? (
              <div style={{ padding: "24px 20px", fontSize: 12, color: "rgba(255,255,255,.45)", textAlign: "center" }}>
                Track list unavailable for this release.
              </div>
            ) : null}
            {tracks.map((tr, idx) => {
              const locked = trackLocked(tr);
              const isActive =
                activeTrack != null &&
                tr != null &&
                (activeTrack === tr ||
                  (activeTrack.id != null &&
                    tr.id != null &&
                    String(activeTrack.id) === String(tr.id)));
              const isPlayingThis = isActive && isPlaying;
              return (
                <div
                  key={tr.id ?? idx}
                  className={`tr${isActive ? " active-tr" : ""}${locked ? " locked" : ""}`}
                  style={isActive ? { background: `${t.p1}12` } : undefined}
                  onClick={() => handleTrack(tr)}
                  onTouchStart={(e) => { swipeRef.current = { slug: tr.slug, startX: e.touches[0].clientX }; }}
                  onTouchEnd={(e) => {
                    if (!swipeRef.current?.slug) return;
                    const deltaX = e.changedTouches[0].clientX - swipeRef.current.startX;
                    if (deltaX > 60) { handleEnqueue(tr, { playNext: false }); showPlaybackNotice(`"${tr.title}" added to queue`); }
                    swipeRef.current = {};
                  }}
                >
                  {isActive ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(to bottom,${t.accent},${t.p1})`, borderRadius: "0 1px 1px 0" }} /> : null}
                  <div style={{ width: 22, flexShrink: 0, fontFamily: "'DM Mono',monospace", fontSize: 10, display: "flex", gap: 2, alignItems: "flex-end", height: 13 }}>
                    {isPlayingThis ? (
                      <>
                        <div className="eq-b" style={{ background: t.accent }} />
                        <div className="eq-b" style={{ background: t.accent }} />
                        <div className="eq-b" style={{ background: t.accent }} />
                      </>
                    ) : (
                      <span style={{ color: isActive ? t.accent : "rgba(255,255,255,.28)" }}>{idx + 1}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: isActive ? 13 : 12, fontWeight: isActive ? 600 : 400, color: isActive ? t.accent : "rgba(255,255,255,.88)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: isActive ? ".01em" : 0, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr.title}</span>
                      {tr.explicit ? <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 7, letterSpacing: ".04em", padding: "1px 4px", borderRadius: 3, border: "1px solid rgba(255,255,255,.2)", color: "rgba(255,255,255,.4)", flexShrink: 0, lineHeight: 1.4 }}>E</span> : null}
                      {tr.lyrics ? <span style={{ color: "rgba(255,255,255,.25)", display: "flex", alignItems: "center", flexShrink: 0 }}><I.Mic /></span> : null}
                    </div>
                    {tr.feat ? <div style={{ fontSize: 10, fontWeight: 300, color: "rgba(255,255,255,.32)" }}>ft. {tr.feat}</div> : null}
                  </div>
                  {userId && tr?.slug && isOfflineCached(userId, tr.slug) ? (
                    <span title="Available offline" style={{ width: 6, height: 6, borderRadius: "50%", background: t.accent, flexShrink: 0, display: "inline-block", boxShadow: `0 0 5px ${t.glow}` }} />
                  ) : null}
                  {tr.free ? (
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 7, letterSpacing: ".1em", padding: "2px 6px", borderRadius: 4, border: `1px solid ${t.p1}55`, color: t.accent, flexShrink: 0 }}>FREE</span>
                  ) : null}
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: isActive ? `${t.accent}99` : "rgba(255,255,255,.25)", flexShrink: 0 }}>{tr.dur}</span>
                  {!isPreview && userId && tr?.slug && typeof tr.slug === "string" && !/^\d+$/.test(tr.slug) ? (
                    <div style={{ flexShrink: 0, position: "relative" }} onClick={(e) => e.stopPropagation()}>
                      {typeof downloadStates[tr.slug] === "number" && downloadStates[tr.slug] !== "done" ? (
                        <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,.12)" strokeWidth="2" />
                            <circle cx="10" cy="10" r="8" stroke={t.accent} strokeWidth="2" strokeLinecap="round"
                              strokeDasharray={`${2 * Math.PI * 8}`}
                              strokeDashoffset={`${2 * Math.PI * 8 * (1 - (downloadProgress[tr.slug] || 0) / 100)}`}
                              transform="rotate(-90 10 10)"
                              style={{ transition: "stroke-dashoffset .3s linear" }}
                            />
                          </svg>
                        </div>
                      ) : (
                        <button
                          type="button"
                          aria-label={downloadStates[tr.slug] === "done" ? "Downloaded" : "Download track"}
                          onClick={(e) => handleDownload(tr, e)}
                          style={{ background: "none", border: "none", padding: "0 4px", cursor: downloadStates[tr.slug] === "done" ? "default" : "pointer", color: downloadStates[tr.slug] === "done" ? t.accent : "rgba(255,255,255,.28)", display: "flex", alignItems: "center" }}
                        >
                          <I.CloudDown />
                        </button>
                      )}
                    </div>
                  ) : null}
                  <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      aria-label="More options"
                      onClick={() => setTrackMenu(tr)}
                      style={{ background: "none", border: "none", padding: "0 2px", cursor: "pointer", color: "rgba(255,255,255,.28)", display: "flex", alignItems: "center" }}
                    >
                      <I.Dots />
                    </button>
                  </div>
                  <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: isPlayingThis ? `${t.p1}22` : "transparent",
                        border: `1.5px solid ${isPlayingThis ? t.accent : `${t.p1}44`}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: locked ? "default" : "pointer",
                        color: isPlayingThis ? t.accent : `${t.p1}cc`,
                        boxShadow: isPlayingThis ? `0 0 10px ${t.glow}` : "none",
                        transition: "box-shadow .2s, border-color .2s",
                      }}
                      onClick={() => handleTrack(tr)}
                    >
                      {isPlayingThis ? <I.TrPause /> : <I.TrPlay />}
                    </button>
                  </div>
                </div>
              );
            })}
            {otherReleases?.length > 0 && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: 14, paddingBottom: 8 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(255,255,255,.3)", padding: "0 20px 10px" }}>More Releases</div>
                <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingLeft: 20, paddingRight: 20, scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", overflowY: "hidden" }}>
                  {otherReleases.map((r) => (
                    <MoreReleaseThumb
                      key={r.slug || r.id}
                      r={r}
                      accentColor={t.accent}
                      onClick={() => onReleaseClick?.(r)}
                    />
                  ))}
                </div>
              </div>
            )}

            {(album?.bio || album?.artistBio) ? (
              <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", padding: "16px 20px 20px" }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: ".24em", textTransform: "uppercase", color: "rgba(255,255,255,.3)", marginBottom: 10 }}>About the Artist</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 14, lineHeight: 1.65, color: "rgba(255,255,255,.55)", fontStyle: "italic" }}>
                  {album.bio || album.artistBio}
                </div>
              </div>
            ) : null}

            <div style={{ height: 8 }} />
          </div>

          {playbackNotice ? (
            <div
              role="status"
              style={{
                flexShrink: 0,
                padding: "8px 18px",
                fontSize: 11,
                lineHeight: 1.35,
                color: t.accent,
                textAlign: "center",
                borderTop: "1px solid rgba(255,255,255,.06)",
                background: "rgba(0,0,0,.25)",
              }}
            >
              {playbackNotice}
            </div>
          ) : null}
        </div>

        {sheet === "share" ? <ShareSheet title={`Share ${album?.type || "Album"}`} sub={`${album?.title} · ${album?.artist}`} t={t} onClose={() => setSheet(null)} /> : null}
        {sheet === "credits" ? (
          <ViewMoreSheet
            title="Credits"
            sub={`${album?.title} · ${album?.artist}`}
            t={t}
            rows={[
              ["RELEASE DATE", album?.year || "—"],
              ["TRACKS", `${tracks.length} tracks`],
              ["FORMAT", "Digital"],
              ["LABEL", "Kastaweh Records"],
            ]}
            onClose={() => setSheet(null)}
          />
        ) : null}
        {sheet === "sleep" ? (
          <SleepTimerSheet t={t} sleepTimerEndsAt={sleepTimerEndsAt} sleepAfterCurrentTrack={sleepAfterCurrentTrack} setSleepTimer={setSleepTimer} onClose={() => setSheet(null)} />
        ) : null}
        {sheet === "queue" ? (
          <QueueSheet
            queue={engineQueue || []}
            queueIndex={engineQueueIndex ?? -1}
            t={t}
            onRemove={(idx) => removeFromQueue?.(idx)}
            onMove={(from, to) => moveInQueue?.(from, to)}
            onClear={handleClearQueue}
            onSaveAsPlaylist={handleSaveQueueAsPlaylist}
            userId={userId}
            onClose={() => setSheet(null)}
          />
        ) : null}
        {sheet === "speed" ? (
          <PlaybackSpeedSheet speed={playbackSpeed} t={t} onSelect={handleSpeedChange} onClose={() => setSheet(null)} />
        ) : null}
        {trackMenu && sheet !== "playlist-pick" && sheet !== "queue" ? (
          <TrackContextSheet
            track={trackMenu}
            album={album}
            t={t}
            onPlayNext={() => handleEnqueue(trackMenu, { playNext: true })}
            onAddToQueue={() => handleEnqueue(trackMenu, { playNext: false })}
            onStartRadio={() => handleStartRadio(trackMenu)}
            onAddToPlaylist={() => setSheet("playlist-pick")}
            onSaveToLibrary={() => handleSaveTrackToLibrary(trackMenu)}
            onGoToArtist={handleGoToArtist}
            onRemoveFromDownloads={() => handleRemoveFromDownloads(trackMenu)}
            isCached={!!(userId && trackMenu?.slug && isOfflineCached(userId, trackMenu.slug))}
            onShare={() => setSheet("track-share")}
            onClose={() => setTrackMenu(null)}
          />
        ) : null}
        {sheet === "playlist-pick" && trackMenu ? (
          <PlaylistPickerSheet
            track={trackMenu}
            album={album}
            userId={userId}
            t={t}
            onClose={() => { setSheet(null); setTrackMenu(null); }}
          />
        ) : null}
        {sheet === "track-share" ? (
          <ShareSheet
            title={`Share "${trackMenu?.title || "Track"}"`}
            sub={`${album?.title} · ${album?.artist}`}
            t={t}
            onClose={() => { setSheet(null); setTrackMenu(null); }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function AlbumModal({ album, onPlayTrackAtIndex, otherReleases, onReleaseClick, ...rest }) {
  if (!album || (!album.slug && !album.id)) return null;
  return <AlbumModalView album={album} onPlayTrackAtIndex={onPlayTrackAtIndex} otherReleases={otherReleases} onReleaseClick={onReleaseClick} {...rest} />;
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
