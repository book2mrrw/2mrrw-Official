"use client";

import { useMemo, useCallback, memo } from "react";
import LyricTranscript from "@/components/lyrics/LyricTranscript";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {decodeLyrics,plainLyrics,activeLyricIndex,isTime} from "@/lib/lyrics/timing";

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <polyline points="9,1 13,1 13,5" /><polyline points="5,13 1,13 1,9" />
    <line x1="13" y1="1" x2="8" y2="6" /><line x1="1" y1="13" x2="6" y2="8" />
  </svg>
);
const CollapseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <polyline points="8,6 13,6 13,1" /><polyline points="6,8 1,8 1,13" />
    <line x1="13" y1="1" x2="8" y2="6" /><line x1="1" y1="13" x2="6" y2="8" />
  </svg>
);
const ShareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="12" height="9" rx="2" />
    <polyline points="4,4 7,1 10,4" /><line x1="7" y1="1" x2="7" y2="9" />
  </svg>
);

function shareLyricCard({ lineText, albumTitle, artist, accentColor = "#9b5de5" }) {
  const SIZE = 400;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Border gradient
  const bd = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bd.addColorStop(0, accentColor);
  bd.addColorStop(1, "#c77dff");
  ctx.strokeStyle = bd;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);

  // Ambient orb
  const orb = ctx.createRadialGradient(SIZE / 2, SIZE / 3, 0, SIZE / 2, SIZE / 3, SIZE * 0.55);
  orb.addColorStop(0, `${accentColor}44`);
  orb.addColorStop(1, "transparent");
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Lyric text with word-wrap
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  const maxW = SIZE - 80;
  const lineH = 30;

  const wrapText = (text, fontSize) => {
    ctx.font = `${fontSize}px Georgia, serif`;
    const words = text.split(" ");
    const wrapped = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) { wrapped.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) wrapped.push(cur);
    return wrapped;
  };

  let lines = wrapText(lineText, 22);
  if (lines.length > 5) lines = wrapText(lineText, 17);
  const totalH = lines.length * lineH;
  const startY = SIZE / 2 - totalH / 2;
  lines.forEach((l, i) => { ctx.fillText(l, SIZE / 2, startY + i * lineH + 8); });

  // Separator
  ctx.fillStyle = `${accentColor}66`;
  ctx.fillRect(SIZE / 2 - 24, startY + totalH + 14, 48, 1);

  // Metadata
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "bold 11px 'DM Mono', monospace";
  ctx.fillText(albumTitle || "2MRRW", SIZE / 2, startY + totalH + 34);
  ctx.fillStyle = accentColor;
  ctx.font = "10px 'DM Mono', monospace";
  ctx.fillText((artist || "2MRRW").toUpperCase(), SIZE / 2, startY + totalH + 50);

  canvas.toBlob((blob) => {
    if (!blob) return;
    if (navigator.share && navigator.canShare?.({ files: [new File([blob], "lyric.png", { type: "image/png" })] })) {
      navigator.share({ files: [new File([blob], "lyric.png", { type: "image/png" })], title: lineText }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "lyric-card.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }, "image/png");
}

function GlyphLyricsPanel({
  open, lrcText, onClose, onSeek, isMobile = false, status = "ready", onRetry,
  fullscreen = false, onFullscreenChange,
  albumTitle, artist, accentColor, playbackTime = null, syncStatus = "legacy", recordingKey,
}) {
  const currentTime = playbackTime;
  const canSeek = typeof onSeek === "function" && isTime(currentTime);
  const reducedMotion = useReducedMotion();
  const model = useMemo(() => {
    const decoded = decodeLyrics(lrcText);
    return decoded.draft || decoded.error || (decoded.reference && syncStatus !== 'verified')
      ? decodeLyrics(plainLyrics(lrcText)) : decoded;
  }, [lrcText, syncStatus]);
  const lines = model.lines;
  const synchronized = lines.some(line => Number.isFinite(line.time) && line.time >= 0);
  const activeIndex = open ? activeLyricIndex(lines, currentTime, {duration:model.duration}) : -1;

  const handleShareLyric = useCallback(() => {
    const activeLine = lines[activeIndex];
    if (!activeLine?.text) return;
    shareLyricCard({ lineText: activeLine.text, albumTitle, artist, accentColor });
  }, [lines, activeIndex, albumTitle, artist, accentColor]);

  const posStyle = fullscreen
    ? { position: "fixed", inset: 0, zIndex: 10000 }
    : { position: "absolute", inset: 0, zIndex: 6 };

  const panel = (
    <AnimatePresence>
      {open ? (
        <motion.div
          key={fullscreen ? "glyphs-full" : "glyphs"}
          initial={{ opacity: 0, y: fullscreen || reducedMotion ? 0 : 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: fullscreen || reducedMotion ? 0 : 16 }}
          transition={{ duration: reducedMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
          role="region"
          aria-label="Lyrics"
          data-artwork-gesture-ignore
          onClick={(e) => e.stopPropagation()}
          style={{
            ...posStyle,
            display: "flex",
            flexDirection: "column",
            background: fullscreen
              ? "rgba(0,0,0,0.97)"
              : "linear-gradient(to bottom, rgba(0,0,0,0.76) 0%, rgba(0,0,0,0.84) 45%, rgba(0,0,0,0.94) 100%)",
            backdropFilter: "blur(12px) saturate(0.55)",
            WebkitBackdropFilter: "blur(12px) saturate(0.55)",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: fullscreen ? "max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left))" : isMobile ? "10px 12px 8px" : "14px 18px 8px",
              flexShrink: 0,
              gap: 10,
            }}
          >
            <button
              type="button"
              aria-label="Back to preview"
              onClick={onClose}
              style={{
                background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 20,
                color: "rgba(255,255,255,0.9)",
                fontSize: isMobile ? 11 : 10,
                fontWeight: 700,
                letterSpacing: isMobile ? 1.5 : 2,
                padding: isMobile ? "8px 14px" : "6px 12px",
                minHeight: 44,
                cursor: "pointer",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              {isMobile ? "← Back" : "Back"}
            </button>
            <span
              className="hero-title-glow"
              style={{ fontSize: 11, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", flex: 1, textAlign: "center" }}
            >
              GLYPHS
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {activeIndex >= 0 && lines[activeIndex]?.text ? (
                <button
                  type="button"
                  aria-label="Share lyric card"
                  onClick={handleShareLyric}
                  style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%", width: 44, height: 44, color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <ShareIcon />
                </button>
              ) : null}
              {onFullscreenChange ? (
                <button
                  type="button"
                  aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen lyrics"}
                  onClick={() => onFullscreenChange(!fullscreen)}
                  style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%", width: 44, height: 44, color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close glyphs"
                onClick={onClose}
                style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%", width: 44, height: 44, color: "rgba(255,255,255,0.85)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ✕
              </button>
            </div>
          </div>

          {lines.length && !synchronized ? <p role="status" style={{margin:"0 20px 8px",fontSize:12,color:"#b8bbc6"}}>Lyrics · not synchronized yet</p> : null}
          {synchronized && !isTime(currentTime) ? <p role="status" style={{margin:"0 20px 8px",fontSize:12,color:"#b8bbc6"}}>Playback position unavailable for this recording.</p> : null}
          {['audio_changed','unavailable','invalid'].includes(syncStatus) ? <p role="status">{syncStatus === 'audio_changed' ? 'The recording changed; lyric timing needs review.' : 'Timing could not be verified. Showing lyric text.'}</p> : null}
          {!lines.length && status === "loading" ? <p role="status">Loading lyrics…</p> : null}
          {!lines.length && status === "error" ? <p role="alert">Lyrics could not be loaded. {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}</p> : null}
          {fullscreen && albumTitle ? (
            <div style={{ textAlign: "center", padding: "0 20px 10px", flexShrink: 0 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 400, color: "rgba(255,255,255,.6)" }}>{albumTitle}</div>
              {artist ? <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", color: "rgba(255,255,255,.3)", marginTop: 2 }}>{artist}</div> : null}
            </div>
          ) : null}

          {lines.length ? <LyricTranscript key={recordingKey || lrcText} lines={lines} activeIndex={activeIndex}
            onSeek={canSeek ? onSeek : undefined} reducedMotion={!!reducedMotion} fullscreen={fullscreen}/>
            : status === "ready" ? <p style={{textAlign:"center",color:"#b8bbc6",fontSize:13,lineHeight:1.7,marginTop:"28%"}}>No lyrics have been added yet.</p> : null}

        </motion.div>
      ) : null}
    </AnimatePresence>
  );
  return fullscreen && typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}

export default memo(GlyphLyricsPanel);
