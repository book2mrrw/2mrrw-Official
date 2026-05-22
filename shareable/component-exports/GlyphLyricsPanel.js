"use client";

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { parseLrc, getActiveLrcIndex } from "@/lib/lrc";

function GlyphLyricsPanel({ open, lrcText, audioRef, onClose }) {
  const lines = useMemo(() => parseLrc(lrcText), [lrcText]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const scrollRef = useRef(null);
  const lineRefs = useRef([]);

  useEffect(() => {
    if (!open || !lines.length) return;
    let frame = 0;
    const tick = () => {
      const t = audioRef.current?.currentTime ?? 0;
      setActiveIndex(getActiveLrcIndex(lines, t));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, lines, audioRef]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    const container = scrollRef.current;
    if (!el || !container) return;
    const top = el.offsetTop - container.clientHeight * 0.38;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeIndex, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="glyphs"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 6,
            display: "flex",
            flexDirection: "column",
            background: "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 38%, rgba(0,0,0,0.92) 100%)",
            backdropFilter: "blur(6px)",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 18px 8px",
              flexShrink: 0,
            }}
          >
            <span
              className="hero-title-glow"
              style={{ fontSize: 11, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase" }}
            >
              GLYPHS
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#aaa",
                fontSize: 10,
                letterSpacing: 2,
                padding: "6px 12px",
                borderRadius: 20,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              Close
            </button>
          </div>
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
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className={active ? "hero-title-glow" : undefined}
                    style={{
                      margin: "0 0 14px",
                      fontSize: active ? 15 : 13,
                      lineHeight: 1.65,
                      textAlign: "center",
                      color: active ? "#fff" : "rgba(255,255,255,0.32)",
                      transition: "color 0.25s, font-size 0.25s, opacity 0.25s",
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    {line.text}
                  </p>
                );
              })
            ) : (
              <p
                style={{
                  textAlign: "center",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 13,
                  lineHeight: 1.7,
                  marginTop: "28%",
                  letterSpacing: 0.3,
                  fontStyle: "italic",
                }}
              >
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
