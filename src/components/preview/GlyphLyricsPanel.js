"use client";

import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { parseLrc, getActiveLrcIndex } from "@/lib/lrc";
import { usePlaybackProgress } from "@/context/AudioContext";

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
  open, lrcText, onClose, onSeek, isMobile = false,
  fullscreen = false, onFullscreenChange,
  albumTitle, artist, accentColor,
}) {
  const { currentTime } = usePlaybackProgress();
  const lines = useMemo(() => parseLrc(lrcText), [lrcText]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const scrollRef = useRef(null);
  const lineRefs = useRef([]);

  useEffect(() => {
    if (!open || !lines.length) return;
    setActiveIndex(getActiveLrcIndex(lines, currentTime));
  }, [open, lines, currentTime]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    const container = scrollRef.current;
    if (!el || !container) return;
    const top = el.offsetTop - container.clientHeight * 0.38;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeIndex, open]);

  const handleShareLyric = useCallback(() => {
    const activeLine = lines[activeIndex];
    if (!activeLine?.text) return;
    shareLyricCard({ lineText: activeLine.text, albumTitle, artist, accentColor });
  }, [lines, activeIndex, albumTitle, artist, accentColor]);

  const posStyle = fullscreen
    ? { position: "fixed", inset: 0, zIndex: 10000 }
    : { position: "absolute", inset: 0, zIndex: 6 };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key={fullscreen ? "glyphs-full" : "glyphs"}
          initial={{ opacity: 0, y: fullscreen ? 0 : 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: fullscreen ? 0 : 16 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...posStyle,
            display: "flex",
            flexDirection: "column",
            background: fullscreen
              ? "rgba(0,0,0,0.97)"
              : "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 38%, rgba(0,0,0,0.92) 100%)",
            backdropFilter: "blur(6px)",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: isMobile ? "10px 12px 8px" : "14px 18px 8px",
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
                  style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%", width: isMobile ? 34 : 32, height: isMobile ? 34 : 32, color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <ShareIcon />
                </button>
              ) : null}
              {onFullscreenChange ? (
                <button
                  type="button"
                  aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen lyrics"}
                  onClick={() => onFullscreenChange(!fullscreen)}
                  style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%", width: isMobile ? 34 : 32, height: isMobile ? 34 : 32, color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close glyphs"
                onClick={onClose}
                style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%", width: isMobile ? 34 : 32, height: isMobile ? 34 : 32, color: "rgba(255,255,255,0.85)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ✕
              </button>
            </div>
          </div>

          {fullscreen && albumTitle ? (
            <div style={{ textAlign: "center", padding: "0 20px 10px", flexShrink: 0 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 400, color: "rgba(255,255,255,.6)" }}>{albumTitle}</div>
              {artist ? <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", color: "rgba(255,255,255,.3)", marginTop: 2 }}>{artist}</div> : null}
            </div>
          ) : null}

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 22px 28px",
              WebkitOverflowScrolling: "touch",
              maskImage: "linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)",
            }}
          >
            {lines.length ? (
              lines.map((line, i) => {
                const active = i === activeIndex;
                return (
                  <p
                    key={`${line.time}-${i}`}
                    ref={(el) => { lineRefs.current[i] = el; }}
                    className={active ? "hero-title-glow" : undefined}
                    onClick={() => line.time != null && onSeek?.(line.time)}
                    style={{
                      margin: "0 0 14px",
                      fontSize: fullscreen ? (active ? 20 : 16) : (active ? 15 : 13),
                      lineHeight: 1.65,
                      textAlign: "center",
                      color: active ? "#fff" : "rgba(255,255,255,0.28)",
                      transition: "color 0.25s, font-size 0.25s",
                      fontWeight: active ? 700 : 400,
                      cursor: onSeek && line.time != null ? "pointer" : "default",
                    }}
                  >
                    {line.text}
                  </p>
                );
              })
            ) : (
              <p style={{ textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: 13, lineHeight: 1.7, marginTop: "28%", letterSpacing: 0.3, fontStyle: "italic" }}>
                Glyphs summon when lyrics are inscribed.
              </p>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default memo(GlyphLyricsPanel);
