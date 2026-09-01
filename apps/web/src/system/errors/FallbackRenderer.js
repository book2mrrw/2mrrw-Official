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

export function ModalErrorFallback({
  message = "This panel could not load.",
  onRetry,
  onClose,
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0,0,0,.82)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        padding: "max(16px, env(safe-area-inset-bottom))",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          ...surfaceStyle,
          width: "100%",
          maxWidth: 430,
          borderRadius: "18px 18px 0 0",
          padding: "22px 20px 28px",
        }}
      >
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "rgba(255,255,255,0.82)", textAlign: "center" }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: "10px 18px",
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
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "transparent",
                color: "rgba(255,255,255,0.65)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
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
