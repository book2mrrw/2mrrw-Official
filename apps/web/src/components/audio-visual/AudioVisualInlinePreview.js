"use client";

/**
 * Plays the Peek clip in place of whatever cover it's swapped in for —
 * sized entirely by its parent's container (position:absolute inset:0), so
 * it's naturally small on a release card and modal-sized inside the
 * release modal with no separate sizing logic. Mirrors PersistentCoverVideo
 * (ImmersivePreviewModal.js) for the actual video element; the CTA row
 * below it is the new part — driven by a single /peek call that already
 * includes tier/full/price_cents (see the peek route's own comment).
 *
 * Escalating to the full video is the parent's job (onWatchFull) — this
 * component never touches the full-screen AudioVisualPlayer itself.
 */
import { useEffect, useRef, useState } from "react";
import { AudioVisualBuyButton } from "@/components/audio-visual/AudioVisualBuyButton";

export function AudioVisualInlinePreview({ videoId, onClose, onWatchFull }) {
  const videoRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/audio-visual/${encodeURIComponent(videoId)}/peek`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data.peek_url) {
          setState({ loading: false, error: data.error || "Preview not available", data: null });
          return;
        }
        setState({ loading: false, error: null, data });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, error: "Preview not available", data: null });
      });
    return () => { cancelled = true; };
  }, [videoId]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !state.data?.peek_url) return;
    void el.play().catch(() => {});
  }, [state.data]);

  const data = state.data;
  const showBuy = data && !data.full && data.price_cents > 0;
  const showOwnForever = data && data.full && data.tier === "subscriber" && data.price_cents > 0;

  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 20, background: "#000", overflow: "hidden" }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        style={{
          position: "absolute", top: 8, right: 8, zIndex: 25, width: 26, height: 26, borderRadius: "50%",
          background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff",
          fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        ✕
      </button>

      {state.loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
          Loading preview…
        </div>
      )}
      {state.error && !state.loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#ff453a", fontSize: 12, textAlign: "center", padding: 12 }}>
          {state.error}
        </div>
      )}

      {data && (
        <>
          <video
            ref={videoRef}
            src={data.peek_url}
            poster={data.poster_url || undefined}
            muted
            loop
            playsInline
            autoPlay
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 22,
              background: "linear-gradient(to top, rgba(0,0,0,0.92), transparent)",
              padding: "20px 10px 10px", display: "flex", flexDirection: "column", gap: 6,
            }}
          >
            {buying ? (
              <AudioVisualBuyButton
                videoId={videoId}
                priceCents={data.price_cents}
                onPurchased={() => { setBuying(false); onWatchFull?.(); }}
              />
            ) : data.full ? (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onWatchFull?.(); }}
                  style={{ width: "100%", padding: "10px 0", background: "#00ffff", color: "#000", fontWeight: 800, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                >
                  Watch Full
                </button>
                {showOwnForever && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setBuying(true); }}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer", textAlign: "center" }}
                  >
                    Own this forever — ${(data.price_cents / 100).toFixed(2)}
                  </button>
                )}
              </>
            ) : showBuy ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setBuying(true); }}
                style={{ width: "100%", padding: "10px 0", background: "#00ffff", color: "#000", fontWeight: 800, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
              >
                Unlock — ${(data.price_cents / 100).toFixed(2)}
              </button>
            ) : (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>Preview</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
