"use client";

/**
 * Shared cinematic-safe fallback surfaces for error boundaries.
 */

const surfaceStyle = {
  background: "rgba(12, 12, 16, 0.96)",
  color: "rgba(255,255,255,0.88)",
  border: "1px solid rgba(255,255,255,0.06)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

export function MinimalErrorSurface({ message = "Something went wrong", onRetry }) {
  return (
    <div
      role="alert"
      style={{
        ...surfaceStyle,
        padding: "16px 20px",
        borderRadius: 10,
        textAlign: "center",
        transition: `opacity var(--motion-duration-base) var(--motion-ease-out)`,
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 12,
            padding: "8px 18px",
            borderRadius: 8,
            border: "1px solid rgba(0, 220, 210, 0.35)",
            background: "rgba(0, 220, 210, 0.1)",
            color: "#00dcd2",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ModalDismissToast({ message = "This panel closed unexpectedly." }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "max(24px, env(safe-area-inset-bottom))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10001,
        padding: "10px 18px",
        borderRadius: 8,
        background: "rgba(8, 8, 12, 0.92)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.7)",
        fontSize: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        transition: `opacity var(--motion-duration-fast) var(--motion-ease-out)`,
        pointerEvents: "none",
      }}
    >
      {message}
    </div>
  );
}

export function MediaErrorChrome({ message = "Playback unavailable for this track." }) {
  return (
    <div
      style={{
        ...surfaceStyle,
        padding: "12px 16px",
        borderRadius: 8,
        fontSize: 12,
        color: "rgba(255,255,255,0.5)",
      }}
    >
      {message}
    </div>
  );
}
