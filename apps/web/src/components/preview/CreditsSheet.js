"use client";
export default function CreditsSheet({ title, sub, t, rows, onClose, status = "ready", onRetry, embedded = false }) {
  return (
    <div role="region" aria-label={title} className="bsheet" style={{ position: embedded ? "relative" : undefined, maxHeight: "80vh", overflowY: "auto", background: t.dark, paddingBottom: "max(28px, env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <button type="button" aria-label="Close credits" onClick={onClose} style={{ float: "right", margin: 12, background: "transparent", color: "white", border: "1px solid #666", borderRadius: 6, padding: "8px 12px", cursor: "pointer" }}>Close</button>
      <div className="sheet-hdl" aria-hidden="true" />
      <div style={{ padding: "6px 22px 10px" }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 400, color: "white", marginBottom: 3 }}>{title}</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", textTransform: "uppercase", color: t.accent }}>{sub}</div>
      </div>
      {status === "loading" ? <p role="status" style={{ padding: 22 }}>Loading credits…</p> : null}
      {status === "error" ? <div role="alert" style={{ padding: 22 }}>Credits could not be loaded. {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}</div> : null}
      {status === "ready" && !rows.length ? <p role="status" style={{ padding: 22 }}>No credits have been added yet.</p> : null}
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
