"use client";

import { memo, useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
  recordPlaybackTraceContext,
} from "@/lib/diagnostics/playback-trace";

const musicVideos = [
  { id: "mv-1", title: "Hour Glass", youtubeId: "tv_aS-hJ880", description: "Official Music Video" },
  { id: "mv-2", title: "A2B", youtubeId: "kPITYHMVeXM", description: "Official Music Video" },
  { id: "mv-3", title: "W.2.D", youtubeId: "jsrA1SL3_GU", description: "Official Music Video" },
];

function PersistentPlayPauseGlyph({ active, size = 16, color = "white" }) {
  return (
    <span
      data-persistent-play-pause-glyph="true"
      style={{ position: "relative", display: "block", width: size, height: size, flexShrink: 0 }}
    >
      <svg
        viewBox="0 0 24 24"
        fill={color}
        width={size}
        height={size}
        aria-hidden
        data-audio-visual-icon="pause"
        style={{ position: "absolute", inset: 0, opacity: active ? 1 : 0 }}
      >
        <path d="M6 19h4V5H6zm8-14v14h4V5z" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        fill={color}
        width={size}
        height={size}
        aria-hidden
        data-audio-visual-icon="play"
        style={{ position: "absolute", inset: 0, marginLeft: 1, opacity: active ? 0 : 1 }}
      >
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}

const AudioVisualsSection = memo(function AudioVisualsSection({
  isMobile,
  onAudioVisualsFocused,
  onAudioVisualsExit,
}) {
  const [featuredId, setFeaturedId] = useState(musicVideos[0].youtubeId);
  const [hasEntered, setHasEntered] = useState(false);
  const sectionRef = useRef(null);
  const iframeRef = useRef(null);
  const firedFocusRef = useRef(false);

  const featuredVid = useMemo(
    () => musicVideos.find((v) => v.youtubeId === featuredId) || musicVideos[0],
    [featuredId]
  );

  const startAudioVisualPlayback = useCallback(() => {
    if (!firedFocusRef.current) {
      firedFocusRef.current = true;
    }
    setHasEntered(true);
  }, []);

  const stopAudioVisualPlayback = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
        "*"
      );
    } catch {
      /* YouTube iframe API is best-effort */
    }
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const threshold = isMobile ? 0.5 : 0.4;
    let hasBeenInView = false;

    const sendCmd = (cmd) => {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "command", func: cmd, args: [] }),
          "*"
        );
      } catch {
        /* YouTube iframe API is best-effort */
      }
    };

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (isPlaybackTraceEnabled()) {
            logUiChurn("intersection", {
              target: "audioVisuals",
              intersecting: true,
              ratio: entry.intersectionRatio,
            });
            recordPlaybackTraceContext({ lastUiSection: "audioVisuals" });
          }
          if (typeof onAudioVisualsFocused === "function") {
            onAudioVisualsFocused();
          }
          startAudioVisualPlayback();
          if (hasBeenInView) {
            sendCmd("playVideo");
          }
          hasBeenInView = true;
        } else if (hasBeenInView) {
          if (isPlaybackTraceEnabled()) {
            logUiChurn("intersection", {
              target: "audioVisuals",
              intersecting: false,
              ratio: entry.intersectionRatio,
            });
          }
          stopAudioVisualPlayback();
          if (typeof onAudioVisualsExit === "function") {
            onAudioVisualsExit();
          }
        }
      },
      { threshold: [0, threshold] }
    );

    obs.observe(el);
    return () => {
      if (hasBeenInView && typeof onAudioVisualsExit === "function") {
        onAudioVisualsExit();
      }
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback((id) => {
    setFeaturedId(id);
  }, []);

  const iframeSrc = useMemo(
    () => `https://www.youtube.com/embed/${featuredId}?rel=0&playsinline=1&autoplay=1&mute=0&enablejsapi=1`,
    [featuredId]
  );

  const handlePlaceholderClick = useCallback(() => {
    if (typeof onAudioVisualsFocused === "function") {
      onAudioVisualsFocused();
    }
    startAudioVisualPlayback();
  }, [onAudioVisualsFocused, startAudioVisualPlayback]);

  return (
    <div ref={sectionRef} data-scroll-persistent-surface="audio-visuals-player">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: isMobile ? 12 : 20, marginTop: isMobile ? 24 : 32 }}>
        <h2 className="section-heading" style={{ margin: 0, fontSize: isMobile ? 17 : 22 }}>Audio Visuals</h2>
        <span style={{ fontSize: 10, color: "#333", letterSpacing: 3, textTransform: "uppercase", fontWeight: 700 }}>Official Visuals</span>
      </div>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 16, overflow: "hidden" }}>
            <div data-persistent-audio-visual-frame="true" style={{ position: "relative", paddingBottom: "56.25%", height: 0, background: "#000", isolation: "isolate" }}>
              <iframe
                ref={iframeRef}
                src={hasEntered ? iframeSrc : undefined}
                title={featuredVid.title}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                data-persistent-audio-visual-player="true"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none", opacity: hasEntered ? 1 : 0, pointerEvents: hasEntered ? "auto" : "none", backfaceVisibility: "hidden", transform: "translate3d(0,0,0)" }}
              />
              <div
                data-persistent-audio-visual-poster="true"
                aria-hidden={hasEntered}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: hasEntered ? "default" : "pointer", opacity: hasEntered ? 0 : 1, pointerEvents: hasEntered ? "none" : "auto" }}
                onClick={handlePlaceholderClick}
              >
                  <img
                    src={`https://img.youtube.com/vi/${featuredId}/mqdefault.jpg`}
                    alt={featuredVid.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "2px solid rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <PersistentPlayPauseGlyph active={false} size={22} />
                    </div>
                  </div>
              </div>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>{featuredVid.title}</div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{featuredVid.description}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
            {musicVideos.map((vid) => {
              const isActive = featuredId === vid.youtubeId;
              return (
                <div
                  key={vid.id}
                  onClick={() => handleSelect(vid.youtubeId)}
                  style={{
                    flex: "0 0 auto",
                    width: 140,
                    scrollSnapAlign: "start",
                    background: "#0e0e0e",
                    border: `1px solid ${isActive ? "#00ffff55" : "#1e1e1e"}`,
                    borderRadius: 12,
                    overflow: "hidden",
                    cursor: "pointer",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                    boxShadow: isActive ? "0 0 12px rgba(0,255,255,0.18)" : "none",
                  }}
                >
                  <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
                    <img
                      src={`https://img.youtube.com/vi/${vid.youtubeId}/mqdefault.jpg`}
                      alt={vid.title}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <div
                      data-persistent-audio-visual-control="true"
                      data-active={isActive ? "true" : "false"}
                      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isActive ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.14)" }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: isActive ? "#00ffff" : "rgba(0,0,0,0.68)", border: isActive ? "none" : "1px solid rgba(255,255,255,0.32)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <PersistentPlayPauseGlyph active={isActive} size={12} color={isActive ? "#000" : "white"} />
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.3, color: isActive ? "#00ffff" : "white" }}>{vid.title}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 0", minWidth: 0, background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 20, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
            <div data-persistent-audio-visual-frame="true" style={{ position: "relative", paddingBottom: "56.25%", height: 0, background: "#000", isolation: "isolate" }}>
              <iframe
                ref={iframeRef}
                src={hasEntered ? iframeSrc : undefined}
                title={featuredVid.title}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                data-persistent-audio-visual-player="true"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none", opacity: hasEntered ? 1 : 0, pointerEvents: hasEntered ? "auto" : "none", backfaceVisibility: "hidden", transform: "translate3d(0,0,0)" }}
              />
              <div
                data-persistent-audio-visual-poster="true"
                aria-hidden={hasEntered}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: hasEntered ? "default" : "pointer", opacity: hasEntered ? 0 : 1, pointerEvents: hasEntered ? "none" : "auto" }}
                onClick={handlePlaceholderClick}
              >
                  <img
                    src={`https://img.youtube.com/vi/${featuredId}/maxresdefault.jpg`}
                    alt={featuredVid.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={(e) => {
                      e.currentTarget.src = `https://img.youtube.com/vi/${featuredId}/mqdefault.jpg`;
                    }}
                  />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.3)" }}>
                    <div
                      style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(0,0,0,0.65)", border: "2px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "scale(1.1)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "scale(1)";
                      }}
                    >
                      <PersistentPlayPauseGlyph active={false} size={32} />
                    </div>
                  </div>
              </div>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>{featuredVid.title}</div>
              <div style={{ fontSize: 12, color: "#555" }}>{featuredVid.description}</div>
            </div>
          </div>

          <div style={{ width: 236, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 9, color: "#2a2a2a", letterSpacing: 3, textTransform: "uppercase", fontWeight: 700, marginBottom: 2 }}>Up Next</div>
            {musicVideos.map((vid) => {
              const isActive = featuredId === vid.youtubeId;
              return (
                <div
                  key={vid.id}
                  onClick={() => handleSelect(vid.youtubeId)}
                  style={{
                    background: isActive ? "#111" : "#0a0a0a",
                    border: `1px solid ${isActive ? "rgba(0,255,255,0.3)" : "#1a1a1a"}`,
                    borderRadius: 14,
                    overflow: "hidden",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    boxShadow: isActive ? "0 0 18px rgba(0,255,255,0.1)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "rgba(0,255,255,0.2)";
                      e.currentTarget.style.background = "#0e0e0e";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "#1a1a1a";
                      e.currentTarget.style.background = "#0a0a0a";
                    }
                  }}
                >
                  <div style={{ display: "flex", gap: 10, padding: 10, alignItems: "center" }}>
                    <div style={{ position: "relative", width: 90, height: 50, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
                      <img
                        src={`https://img.youtube.com/vi/${vid.youtubeId}/mqdefault.jpg`}
                        alt={vid.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                      <div
                        data-persistent-audio-visual-control="true"
                        data-active={isActive ? "true" : "false"}
                        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isActive ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.18)", transition: "background 0.2s" }}
                      >
                        <PersistentPlayPauseGlyph active={isActive} size={16} color={isActive ? "#00ffff" : "rgba(255,255,255,0.88)"} />
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: isActive ? "#00ffff" : "white",
                          lineHeight: 1.3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {vid.title}
                      </div>
                      <div style={{ fontSize: 10, color: "#444", marginTop: 2, lineHeight: 1.3 }}>{vid.description}</div>
                      <div
                        aria-hidden={!isActive}
                        style={{ minHeight: 10, fontSize: 8, color: "#00ffff", letterSpacing: 2.5, marginTop: 4, fontWeight: 700, textTransform: "uppercase", opacity: isActive ? 1 : 0 }}
                      >
                        Now Playing
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export default AudioVisualsSection;
