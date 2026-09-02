"use client";

import { useState } from "react";

/**
 * Shared in-place MFA re-verification prompt for any admin screen whose API
 * call comes back with a recoverable admin-authority denial (see
 * RECOVERABLE_ADMIN_AUTH_CODES in "@/lib/auth/admin-auth-codes"). Renders as a
 * fixed overlay above the current screen — the caller's mounted tree, scroll
 * position, and any in-progress state (an upload, a form draft) are untouched;
 * on success it just calls onVerified() so the caller can resume exactly where
 * it left off, no navigation or reload involved.
 *
 * Extracted from InlineReleasesManager.js so every admin surface can reuse the
 * same recovery flow instead of dead-ending on a generic error.
 */
const C = {
  surface2: "#111",
  border2: "rgba(255,255,255,0.12)",
  accentBorder: "rgba(0,255,255,0.22)",
  accent: "#00ffff",
  text: "#e8e8e8",
  muted: "rgba(255,255,255,0.45)",
  error: "#ff453a",
};

function OverlayInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
        borderRadius: 8, color: C.text, fontSize: 14, padding: "10px 13px",
        outline: "none", boxSizing: "border-box", fontFamily: "inherit",
      }}
    />
  );
}

export function AdminVerificationOverlay({ email: initialEmail, onVerified, onCancel }) {
  const [phase, setPhase] = useState("credentials");
  const [email, setEmail] = useState(initialEmail || "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submitCredentials = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login-step1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Verification could not be started");
      setCode("");
      setPhase("code");
    } catch (verificationError) {
      setError(verificationError.message);
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (event) => {
    event.preventDefault();
    if (loading) return;
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login-step2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: normalizedCode }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.expired) {
          setPassword("");
          setCode("");
          setPhase("credentials");
        }
        throw new Error(body.error || "Verification failed");
      }
      await onVerified();
    } catch (verificationError) {
      setError(verificationError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-verification-title"
      style={{
        position: "fixed", inset: 0, zIndex: 10020,
        display: "grid", placeItems: "center", padding: 20,
        background: "rgba(0,0,0,0.76)", backdropFilter: "blur(18px)",
      }}
    >
      <form
        onSubmit={phase === "credentials" ? submitCredentials : submitCode}
        style={{
          width: "min(420px, 100%)", padding: 26, borderRadius: 18,
          background: "rgba(13,13,13,0.98)", border: `1px solid ${C.accentBorder}`,
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div id="admin-verification-title" style={{ fontSize: 20, fontWeight: 900, color: C.text }}>
          Verify admin session
        </div>
        <p style={{ margin: "8px 0 20px", color: C.muted, fontSize: 13, lineHeight: 1.55 }}>
          {phase === "credentials"
            ? "Your work is intact. Re-verify to restore secure access without leaving this page or interrupting anything in progress."
            : "Enter the 6-digit code sent to your email or phone."}
        </p>

        {phase === "credentials" ? (
          <>
            <OverlayInput value={email} onChange={setEmail} placeholder="Email" type="email" />
            <div style={{ height: 10 }} />
            <OverlayInput value={password} onChange={setPassword} placeholder="Password" type="password" />
          </>
        ) : (
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="6-digit verification code"
            placeholder="000000"
            style={{
              width: "100%", boxSizing: "border-box", background: C.surface2,
              border: `1px solid ${C.border2}`, borderRadius: 10, color: C.text,
              padding: "13px 16px", textAlign: "center", fontSize: 24,
              fontWeight: 800, letterSpacing: "0.32em", outline: "none",
            }}
          />
        )}

        {error && <div style={{ marginTop: 12, color: C.error, fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              flex: 1, padding: "11px 14px", borderRadius: 9,
              border: `1px solid ${C.border2}`, background: C.surface2,
              color: C.muted, fontWeight: 700, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !email || (phase === "credentials" ? !password : code.length !== 6)}
            style={{
              flex: 1.5, padding: "11px 14px", borderRadius: 9, border: "none",
              background: C.accent, color: "#000", fontWeight: 900,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading ? "Verifying…" : phase === "credentials" ? "Send Code" : "Verify & Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
