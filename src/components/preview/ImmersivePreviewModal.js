"use client";

import { useMemo, useState, memo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { isFirstListen, markListened } from "@/lib/first-listen";
import { useAudioPlayer } from "@/context/AudioContext";
import PreviewEndedCTA from "@/components/preview/PreviewEndedCTA";
import { getReleaseEditorial, getCreditsDisplayRows } from "@/components/preview/releaseMetadata";
import { extractLrcFromRelease } from "@/lib/lrc";
import { useCoverPalette, paletteToCssVars } from "@/hooks/useCoverPalette";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import { usePlayerBodyState } from "@/lib/player/usePlayerBodyState";
import { PlayerAtmosphere } from "@/components/player/ImmersivePlayerEngine";
import ModalShell from "@/components/modal/ModalShell";
import ImmersiveModalEnvironment from "@/components/preview/immersive/ImmersiveModalEnvironment";
import ImmersiveModalAccessBadge from "@/components/preview/immersive/ImmersiveModalAccessBadge";
import ImmersiveModalScene from "@/components/preview/immersive/ImmersiveModalScene";
import FloatingViewMore from "@/components/preview/immersive/FloatingViewMore";
import GlyphLyricsPanel from "@/components/preview/GlyphLyricsPanel";
import { ImmersiveModalSkeleton } from "@/ui/skeletons";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import { ImmersiveErrorBoundary } from "@/system/errors";
import { useMediaTiming } from "@/system/performance";
import { useMediaEngine } from "@/media/useMediaEngine";

const DRAWER_COLLAPSE_THRESHOLD = 72;
const MODAL_DISMISS_THRESHOLD = 56;

const fmt = (s) => {
  if (!s || isNaN(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

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

function CoverArtLayer({ coverSrc }) {
  const url = useMemo(() => resolveAbsoluteArtworkUrl(coverSrc), [coverSrc]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    if (!url) return undefined;
    const img = new Image();
    img.src = url;
    img.onload = () => setLoaded(true);
    img.onerror = () => setLoaded(false);
    return undefined;
  }, [url]);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: loaded ? 0.42 : 0,
        transition: "opacity .7s ease",
        zIndex: 2,
        pointerEvents: "none",
      }}
    />
  );
}

function Waveform({ playing, palette, bars = 26 }) {
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
            background: `linear-gradient(to top,${palette.primaryCss},${palette.secondaryCss})`,
            transition: "transform .08s ease",
          }}
        />
      ))}
    </div>
  );
}

function ScrubBar({ pct, palette, onSeekRatio, isPreview }) {
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
            borderRight: `1px dashed ${palette.primaryMuted}`,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <div
        style={{
          width: `${Math.min(100, pct)}%`,
          height: "100%",
          borderRadius: 4,
          background: `linear-gradient(90deg,${palette.primaryCss},${palette.secondaryCss})`,
          boxShadow: `0 0 8px ${palette.primaryGlow}`,
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
              background: palette.secondaryCss,
              boxShadow: `0 0 8px ${palette.primaryGlow}`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function FloatingPlayer({ palette, playing, current, duration, isPreview, beat, onPlay, onSeekRatio }) {
  const pct = duration ? (current / duration) * 100 : 0;
  const vars = paletteToCssVars(palette);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        padding: "10px 20px 16px",
        background:
          "linear-gradient(to top,rgba(0,0,0,.92) 0%,rgba(0,0,0,.55) 60%,transparent 100%)",
        ...vars,
      }}
    >
      <Waveform playing={playing} palette={palette} bars={26} />
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
        <ScrubBar pct={pct} palette={palette} onSeekRatio={onSeekRatio} isPreview={isPreview} />
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
        <button type="button" className={`c-sm${beat ? " beat" : ""}`} aria-hidden tabIndex={-1}>
          <I.Shuffle />
        </button>
        <button type="button" className={`c-md${beat ? " beat" : ""}`} aria-hidden tabIndex={-1}>
          <I.Prev />
        </button>
        <button
          type="button"
          className={`c-lg${playing ? " playing" : ""}${beat ? " beat" : ""}`}
          onClick={onPlay}
          style={vars}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <I.Pause /> : <I.Play />}
        </button>
        <button type="button" className={`c-md${beat ? " beat" : ""}`} aria-hidden tabIndex={-1}>
          <I.Next />
        </button>
        <button type="button" className={`c-sm${beat ? " beat" : ""}`} aria-hidden tabIndex={-1}>
          <I.Repeat />
        </button>
      </div>
    </div>
  );
}

function MobileV9VisitorCta({ single, palette, priceLabel, onAddToCart }) {
  const durLabel = single?.dur || single?.durationLabel || "";
  return (
    <div
      style={{
        padding: "14px 18px",
        borderRadius: 14,
        background: `linear-gradient(135deg,${palette.primaryMuted},rgba(0,0,0,.3))`,
        border: `1px solid ${palette.primaryMuted}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: palette.primaryCss, marginBottom: 2 }}>Own this track</div>
        <div
          style={{
            fontFamily: "'DM Mono',monospace",
            fontSize: 9,
            color: "rgba(255,255,255,.35)",
            letterSpacing: ".1em",
          }}
        >
          FULL QUALITY · {durLabel}
          {priceLabel ? ` · ${priceLabel}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onAddToCart}
        style={{
          padding: "9px 16px",
          borderRadius: 20,
          background: palette.primaryCss,
          border: "none",
          fontSize: 11,
          fontWeight: 800,
          color: "rgba(0,0,0,.9)",
          cursor: "pointer",
          letterSpacing: ".06em",
          boxShadow: `0 0 20px ${palette.primaryMuted}`,
        }}
      >
        BUY
      </button>
    </div>
  );
}

function MobileV9OwnerPanel({ palette, sceneDark }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 14,
        background: `linear-gradient(135deg,${palette.primaryMuted},rgba(0,0,0,.2))`,
        border: `1px solid ${palette.primaryMuted}`,
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
          background: palette.primaryGlow,
          border: `1px solid ${palette.primaryCss}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={sceneDark} strokeWidth="2.5" strokeLinecap="round">
          <polyline points="2,7 6,11 12,3" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: palette.primaryCss }}>You own this track</div>
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
  );
}

function MobileV9Layout({
  single,
  palette,
  paletteVars,
  sceneDark,
  coverSrc,
  coverType,
  coverArtKey,
  creditRows,
  viewMoreOpen,
  onViewMoreToggle,
  onViewMoreCollapse,
  handleDrawerDragEnd,
  glyphsOpen,
  lrcText,
  onCloseGlyphs,
  canStream,
  previewOnly,
  trackAccess,
  showPurchase,
  priceLabel,
  userId,
  onLibraryChange,
  isAdmin,
  onAddToCart,
  onGift,
  onAddVinyl,
  previewEndedCTA,
  handleCloseClick,
}) {
  const {
    state: { playbackState, currentTime },
    analyser,
  } = useMediaEngine();
  const { currentTrack, isPlaying, duration, seek, toggle, playTrack } = useAudioPlayer();
  const beat = useBeat(Boolean(isPlaying && currentTrack?.slug === single?.slug));

  const isThisTrack = Boolean(single?.slug && currentTrack?.slug === single.slug);
  const playing = Boolean(isThisTrack && isPlaying);

  const effectiveDuration = useMemo(() => {
    const d = Number.isFinite(duration) ? duration : 0;
    if (previewOnly) return Math.min(d || 30, 30);
    return d;
  }, [duration, previewOnly]);

  const effectiveCurrent = useMemo(() => {
    const c = Number.isFinite(currentTime) ? currentTime : 0;
    if (previewOnly) return Math.min(c, 30);
    return c;
  }, [currentTime, previewOnly]);

  const handlePlayPause = useCallback(() => {
    if (!single) return;
    if (!isThisTrack) {
      void playTrack({ ...single }, { resumeAt: 0 });
      return;
    }
    toggle();
  }, [single, isThisTrack, playTrack, toggle]);

  const handleSeekRatio = useCallback(
    (r) => {
      if (!Number.isFinite(r)) return;
      const d = effectiveDuration || (previewOnly ? 30 : 0);
      const next = Math.max(0, Math.min(d, r * d));
      seek(next);
    },
    [effectiveDuration, previewOnly, seek]
  );

  const releaseType = single?.type || single?.releaseType || "Single";
  const durLabel = single?.dur || single?.durationLabel || "";
  const owned = Boolean(trackAccess?.owned);

  return (
    <>
      {/* ══ ART ZONE — 62% ══ */}
      <div className="modal-immersive-art-zone" style={{ flex: "0 0 62%", position: "relative", overflow: "hidden" }}>
        <ImmersiveModalScene
          palette={palette}
          analyser={analyser}
          previewOnly={previewOnly}
          playbackState={playbackState}
          currentTime={effectiveCurrent}
        />
        <CoverArtLayer coverSrc={coverSrc} />

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
          <div className="drag-pill" onClick={handleCloseClick} role="button" tabIndex={0} aria-label="Close preview" />
        </div>

        <div style={{ position: "absolute", top: 12, right: 14, zIndex: 30 }}>
          <ImmersiveModalAccessBadge trackAccess={trackAccess} canStream={canStream} palette={palette} />
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
          <div className="art-lbl" style={{ "--glow": palette.primaryGlow, "--glow-dim": palette.primaryMuted }}>
            {single?.title}
          </div>
        </div>

        {previewOnly ? (
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
        ) : null}

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
          <FloatingViewMore
            open={viewMoreOpen}
            onToggle={onViewMoreToggle}
            onCollapse={onViewMoreCollapse}
            isMobile
            creditRows={creditRows}
            handleDrawerDragEnd={handleDrawerDragEnd}
            palette={palette}
          />
        </div>

        <FloatingPlayer
          palette={palette}
          playing={playing}
          current={effectiveCurrent}
          duration={effectiveDuration || (previewOnly ? 30 : 0)}
          isPreview={previewOnly}
          beat={beat}
          onPlay={handlePlayPause}
          onSeekRatio={handleSeekRatio}
        />

        <GlyphLyricsPanel open={glyphsOpen} lrcText={lrcText} isMobile onClose={onCloseGlyphs} />
      </div>

      {/* ══ INFO ZONE — 38% ══ */}
      <div className="modal-immersive-info-zone" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: sceneDark, ...paletteVars }}>
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
              {single?.title}
            </div>
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: ".3em",
                textTransform: "uppercase",
                color: palette.primaryCss,
              }}
            >
              {single?.artist || "2MRRW"}
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
              {releaseType} · {previewOnly ? "30 sec preview" : durLabel || "Full track"}
            </div>
          </div>

          {previewOnly && showPurchase ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 52 }}>
              <button
                type="button"
                className="icon-btn cart-pulse"
                style={{ color: palette.primaryCss, "--glow": palette.primaryGlow, "--glow-dim": palette.primaryMuted }}
                aria-label={priceLabel ? `Add to cart ${priceLabel}` : "Add to cart"}
                onClick={onAddToCart}
              >
                <I.Cart s={34} />
              </button>
              <Link
                href="/subscribe"
                className="icon-btn"
                style={{ color: palette.primaryCss, filter: `drop-shadow(0 0 6px ${palette.primaryGlow})` }}
                aria-label="Subscribe for unlimited streaming"
              >
                <I.Sub s={28} />
              </Link>
              <MusicPlusButton
                track={single}
                userId={userId}
                access={trackAccess}
                onLibraryChange={onLibraryChange}
                sheetBg={sceneDark}
                style={{ color: "rgba(255,255,255,.55)" }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 52 }}>
              <span className="icon-btn col-glow" style={{ color: palette.primaryCss, "--glow": palette.primaryGlow }} aria-hidden>
                <I.Coll s={30} />
              </span>
              <MusicPlusButton
                track={single}
                userId={userId}
                access={trackAccess}
                onLibraryChange={onLibraryChange}
                sheetBg={sceneDark}
                style={{ color: "rgba(255,255,255,.55)" }}
              />
              {isAdmin ? (
                <button type="button" className="icon-btn" style={{ color: "rgba(255,255,255,.38)" }} onClick={onGift} aria-label="Send gift">
                  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="13" y1="4" x2="13" y2="22" />
                    <line x1="4" y1="13" x2="22" y2="13" />
                  </svg>
                </button>
              ) : null}
            </div>
          )}

          {previewEndedCTA}

          {previewOnly && showPurchase ? (
            <MobileV9VisitorCta single={single} palette={palette} priceLabel={priceLabel} onAddToCart={onAddToCart} />
          ) : null}

          {!previewOnly && (owned || canStream) ? <MobileV9OwnerPanel palette={palette} sceneDark={sceneDark} /> : null}

          {showPurchase ? (
            <button type="button" className="modal-immersive-vinyl-link" onClick={onAddVinyl}>
              + Add Vinyl – $47.99 (Optional)
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ImmersivePreviewModal({
  single: singleProp,
  track,
  releaseDetail,
  isMobile,
  onClose,
  onAddToCart,
  onAddVinyl,
  trackAccess = null,
  userId = null,
  isAdmin = false,
  onGift,
  onLibraryChange,
}) {
  const single = singleProp || track;

  useRenderTracker("ImmersivePreviewModal");
  const { onImmersiveRenderStart, onImmersiveRenderEnd } = useMediaTiming();
  const { previewEnded, setPreviewEnded, currentTrack, playTrack } = useAudioPlayer();
  const [contentReady, setContentReady] = useState(false);
  const [viewMoreOpen, setViewMoreOpen] = useState(false);
  const [glyphsOpen, setGlyphsOpen] = useState(false);
  const [firstListen, setFirstListen] = useState(false);
  const [ownershipMoment, setOwnershipMoment] = useState(false);
  const prevCanStreamRef = useRef(false);

  const release = releaseDetail || single;
  const editorial = useMemo(() => getReleaseEditorial(release), [release]);
  const creditRows = useMemo(() => getCreditsDisplayRows(editorial), [editorial]);
  const lrcText = useMemo(() => {
    const lrc = extractLrcFromRelease(release);
    if (lrc?.trim()) return lrc;
    const tr = Array.isArray(release?.tracks) ? release.tracks[0] : null;
    return tr?.lyricsText || tr?.lyrics_text || tr?.lyrics || "";
  }, [release]);
  const hasLyrics = Boolean(lrcText?.trim());

  usePlayerBodyState({ modalOpen: true });

  useEffect(() => {
    onImmersiveRenderStart();
    setContentReady(false);
    const t = requestAnimationFrame(() => {
      setContentReady(true);
      onImmersiveRenderEnd();
    });
    return () => cancelAnimationFrame(t);
  }, [single?.id, release?.slug, onImmersiveRenderStart, onImmersiveRenderEnd]);

  useEffect(() => {
    if (!single?.slug || !isFirstListen(single.slug)) return undefined;
    setFirstListen(true);
    const timer = setTimeout(() => {
      setFirstListen(false);
      markListened(single.slug);
    }, 3000);
    return () => clearTimeout(timer);
  }, [single?.slug]);

  useEffect(() => {
    if (trackAccess?.canStream && !prevCanStreamRef.current) {
      setOwnershipMoment(true);
      const timer = setTimeout(() => setOwnershipMoment(false), 800);
      prevCanStreamRef.current = Boolean(trackAccess?.canStream);
      return () => clearTimeout(timer);
    }
    prevCanStreamRef.current = Boolean(trackAccess?.canStream);
    return undefined;
  }, [trackAccess?.canStream]);

  const closeModal = useCallback(() => {
    setViewMoreOpen(false);
    setGlyphsOpen(false);
    onClose();
  }, [onClose]);

  const handleCloseClick = useCallback(
    (e) => {
      e.stopPropagation();
      closeModal();
    },
    [closeModal]
  );

  const collapseDrawer = useCallback(() => setViewMoreOpen(false), []);

  const handleOverlayClick = useCallback(() => {
    if (glyphsOpen) {
      setGlyphsOpen(false);
      return;
    }
    closeModal();
  }, [glyphsOpen, closeModal]);

  const handleDrawerDragEnd = useCallback((_e, info) => {
    if (info.offset.y > DRAWER_COLLAPSE_THRESHOLD || info.velocity.y > 420) {
      collapseDrawer();
    }
  }, [collapseDrawer]);

  const handleModalDismissDragEnd = useCallback(
    (_e, info) => {
      if (info.offset.y > MODAL_DISMISS_THRESHOLD || info.velocity.y > 400) {
        closeModal();
      }
    },
    [closeModal]
  );

  const coverDisplay = useMemo(() => catalogCoverDisplay(single || {}), [single]);
  const coverSrc = coverDisplay.src;
  const coverType = coverDisplay.type || single?.coverArtType || "image";
  const coverArtKey = single?.slug || single?.id || "preview";
  const palette = useCoverPalette(coverSrc, coverType);
  const paletteVars = paletteToCssVars(palette);
  const canStream = Boolean(trackAccess?.canStream);
  const previewOnly = Boolean(trackAccess && !trackAccess.canStream);
  const showPurchase = trackAccess ? Boolean(trackAccess.showCart) : true;
  const priceLabel =
    single?.price != null && showPurchase ? `$${Number(single.price).toFixed(2)}` : null;
  const showPreviewEndedCTA =
    previewOnly && previewEnded && Boolean(single?.slug) && currentTrack?.slug === single.slug;
  const sceneDark = palette.ambientTintCss;

  const handleAddToCart = useCallback(() => {
    onAddToCart?.(single);
    closeModal();
  }, [onAddToCart, single, closeModal]);

  const handleUnlockFromPreviewEnd = useCallback(() => {
    onAddToCart?.(single);
  }, [onAddToCart, single]);

  const handleContinueListening = useCallback(() => {
    setPreviewEnded(false);
    if (currentTrack?.slug === single?.slug && currentTrack) {
      void playTrack({ ...currentTrack }, { resumeAt: 0 });
    }
  }, [setPreviewEnded, currentTrack, single?.slug, playTrack]);

  const previewEndedCTA = useMemo(
    () =>
      showPreviewEndedCTA ? (
        <PreviewEndedCTA
          priceLabel={priceLabel}
          showPurchase={showPurchase}
          onContinueListening={handleContinueListening}
          onUnlock={handleUnlockFromPreviewEnd}
        />
      ) : null,
    [showPreviewEndedCTA, priceLabel, showPurchase, handleContinueListening, handleUnlockFromPreviewEnd]
  );

  const handleViewMoreToggle = useCallback(() => {
    setGlyphsOpen(false);
    setViewMoreOpen((o) => !o);
  }, []);

  const handleOpenGlyphs = useCallback(() => {
    setViewMoreOpen(false);
    setGlyphsOpen(true);
  }, []);

  const handleCloseGlyphs = useCallback(() => setGlyphsOpen(false), []);

  const handleAddVinyl = useCallback(() => {
    onAddVinyl?.(single);
    closeModal();
  }, [onAddVinyl, single, closeModal]);

  const handleGift = useCallback(() => onGift?.(single), [onGift, single]);

  const desktopShellStyle = useMemo(
    () => ({
      width: "min(420px, 96vw)",
      maxWidth: "100%",
      maxHeight: "94vh",
      boxShadow: `0 0 48px ${palette.primaryGlow}, 0 24px 80px rgba(0,0,0,0.65)`,
    }),
    [palette.primaryGlow]
  );

  const desktopStageStyle = useMemo(
    () => ({
      position: "relative",
      width: "100%",
      height: "min(52vh, 520px)",
      flexShrink: 0,
      overflow: "hidden",
      background: "#000",
    }),
    []
  );

  const panelStyle = useMemo(
    () => ({
      opacity: glyphsOpen ? 0 : 1,
      pointerEvents: glyphsOpen ? "none" : "auto",
      ...(isMobile ? {} : { padding: "16px 22px 22px", display: "flex", flexDirection: "column", gap: 10 }),
    }),
    [glyphsOpen, isMobile]
  );

  const stageProps = useMemo(
    () => ({
      coverSrc,
      coverType,
      coverArtKey,
      title: single?.title,
      palette,
      isMobile,
      creditRows,
      viewMoreOpen,
      onViewMoreToggle: handleViewMoreToggle,
      onViewMoreCollapse: collapseDrawer,
      handleDrawerDragEnd,
      glyphsOpen,
      lrcText,
      onCloseGlyphs: handleCloseGlyphs,
      canStream,
      previewOnly,
      track: single,
    }),
    [
      coverSrc,
      coverType,
      coverArtKey,
      single?.title,
      palette,
      isMobile,
      creditRows,
      viewMoreOpen,
      handleViewMoreToggle,
      collapseDrawer,
      handleDrawerDragEnd,
      glyphsOpen,
      lrcText,
      handleCloseGlyphs,
      canStream,
      previewOnly,
      single,
    ]
  );

  const panelProps = useMemo(
    () => ({
      panelStyle,
      single,
      trackAccess,
      canStream,
      showPurchase,
      priceLabel,
      userId,
      onLibraryChange,
      hasLyrics,
      onOpenGlyphs: handleOpenGlyphs,
      palette,
      isAdmin,
      onAddToCart: handleAddToCart,
      onGift: handleGift,
      onAddVinyl: handleAddVinyl,
      onClose: closeModal,
      previewEndedCTA,
    }),
    [
      panelStyle,
      single,
      trackAccess,
      canStream,
      showPurchase,
      priceLabel,
      userId,
      onLibraryChange,
      hasLyrics,
      handleOpenGlyphs,
      palette,
      isAdmin,
      handleAddToCart,
      handleGift,
      handleAddVinyl,
      closeModal,
      previewEndedCTA,
    ]
  );

  if (!single) return null;

  return (
    <ImmersiveErrorBoundary onExitImmersive={onClose}>
      <ModalShell
        stackId="immersive-preview"
        isMobile={isMobile}
        paletteVars={paletteVars}
        onOverlayClick={handleOverlayClick}
        onDragEnd={handleModalDismissDragEnd}
        onClose={onClose}
        desktopStyle={desktopShellStyle}
      >
        <PlayerAtmosphere open />
        <div
          className={[
            "modal-immersive-body",
            isMobile ? "modal-immersive-body--mobile" : "modal-immersive-body--desktop",
            firstListen ? "modal-immersive--first-listen" : "",
            ownershipMoment ? "modal-immersive--owned-flash" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={isMobile ? paletteVars : undefined}
        >
          {!contentReady ? (
            <ImmersiveModalSkeleton isMobile={isMobile} />
          ) : isMobile ? (
            <MobileV9Layout
              single={single}
              palette={palette}
              paletteVars={paletteVars}
              sceneDark={sceneDark}
              coverSrc={coverSrc}
              creditRows={creditRows}
              viewMoreOpen={viewMoreOpen}
              onViewMoreToggle={handleViewMoreToggle}
              onViewMoreCollapse={collapseDrawer}
              handleDrawerDragEnd={handleDrawerDragEnd}
              glyphsOpen={glyphsOpen}
              lrcText={lrcText}
              onCloseGlyphs={handleCloseGlyphs}
              canStream={canStream}
              previewOnly={previewOnly}
              trackAccess={trackAccess}
              showPurchase={showPurchase}
              priceLabel={priceLabel}
              userId={userId}
              onLibraryChange={onLibraryChange}
              isAdmin={isAdmin}
              onAddToCart={handleAddToCart}
              onGift={handleGift}
              onAddVinyl={handleAddVinyl}
              previewEndedCTA={previewEndedCTA}
              handleCloseClick={handleCloseClick}
            />
          ) : (
            <ImmersiveModalEnvironment
              contentReady={contentReady}
              isMobile={isMobile}
              glyphsOpen={glyphsOpen}
              desktopStageStyle={desktopStageStyle}
              desktopStageMotion={{ boxShadow: `0 0 36px ${palette.primaryGlow}` }}
              stageProps={stageProps}
              panelProps={panelProps}
              onCloseClick={handleCloseClick}
              trackAccess={trackAccess}
              canStream={canStream}
              palette={palette}
            />
          )}
        </div>
      </ModalShell>
    </ImmersiveErrorBoundary>
  );
}

export default memo(ImmersivePreviewModal);
