"use client";

import { useMemo, useState } from "react";
import { LYRICS_LABEL } from "@/lib/releases";

function parseLyricsLines(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function ReleaseDetailExtras({ release }) {
  const [creditsOpen, setCreditsOpen] = useState(false);
  const tracks = Array.isArray(release?.tracks) ? release.tracks : [];
  const credits = Array.isArray(release?.credits) ? release.credits : [];
  const primaryTrack = tracks[0];
  const lyricsMode = primaryTrack?.lyricsMode || primaryTrack?.lyrics_mode || "static";
  const lyricsText = primaryTrack?.lyricsText || primaryTrack?.lyrics_text || primaryTrack?.lyrics || "";
  const lines = useMemo(() => parseLyricsLines(lyricsText), [lyricsText]);

  if (!lines.length && !credits.length) return null;

  return (
    <div className="release-detail-extras" style={{ marginTop: 16, width: "100%" }}>
      {lines.length ? (
        <section style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 2,
              textTransform: "uppercase",
              opacity: 0.45,
              marginBottom: 8
            }}
          >
            {LYRICS_LABEL} {lyricsMode === "timed" ? "· Living Scroll" : ""}
          </div>
          <div
            className={lyricsMode === "timed" ? "living-scroll-lyrics" : "static-lyrics-panel"}
            style={
              lyricsMode === "timed"
                ? undefined
                : {
                    maxHeight: 180,
                    overflowY: "auto",
                    padding: "12px 14px",
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: 10,
                    border: "1px solid #1a1a1a",
                    fontSize: 12,
                    lineHeight: 1.75,
                    color: "#bbb"
                  }
            }
          >
            {lines.map((line, index) => (
              <p key={`${index}-${line.slice(0, 12)}`} className="living-scroll-line">
                {line}
              </p>
            ))}
          </div>
        </section>
      ) : null}
      {credits.length ? (
        <section>
          <button
            type="button"
            onClick={() => setCreditsOpen((open) => !open)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid #1a1a1a",
              borderRadius: 10,
              padding: "10px 12px",
              color: "#ccc",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              cursor: "pointer"
            }}
          >
            Credits &amp; Details
            <span style={{ opacity: 0.5 }}>{creditsOpen ? "−" : "+"}</span>
          </button>
          {creditsOpen ? (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                border: "1px solid #1a1a1a",
                borderRadius: 10,
                background: "#0a0a0a"
              }}
            >
              {credits.map((credit) => (
                <div
                  key={credit.id || `${credit.name}-${credit.role}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "6px 0",
                    borderBottom: "1px solid #141414",
                    fontSize: 12
                  }}
                >
                  <span style={{ color: "#eee" }}>{credit.name}</span>
                  <span style={{ color: "#666" }}>{credit.role}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
