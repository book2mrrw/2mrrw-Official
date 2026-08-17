
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateEmail } from "@/lib/auth/validation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";

const DISMISS_DRAG_PX = 80;
const CODE_LENGTH = 6;
const EMPTY_DIGITS = () => Array(CODE_LENGTH).fill("");

const inputStyle = {
  padding: "14px 16px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "white",
  borderRadius: 12,
  fontSize: 15,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 12,
};
const ctaStyle = {
  padding: "15px 0",
  background: "#00ffff",
  color: "#000",
  fontWeight: 800,
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  width: "100%",
  fontSize: 15,
  letterSpacing: 0.5,
  marginTop: 4,
};
const linkStyle = {
  background: "none",
  border: "none",
  color: "#00ffff",
  fontSize: 14,
  textAlign: "center",
  cursor: "pointer",
  padding: 0,
  marginTop: 14,
  width: "100%",
  display: "block",
};
const errorStyle = {
  color: "#ef4444",
  fontSize: 12,
  marginBottom: 8,
  marginTop: -6,
};
const GLOW_KEYFRAMES = `
  @keyframes wordmarkGlow {
    0%, 100% {
      text-shadow:
        0 0 8px rgba(0,255,255,0.4),
        0 0 20px rgba(0,255,255,0.2),
        0 0 40px rgba(0,255,255,0.1);
    }
    50% {
      text-shadow:
        0 0 12px rgba(0,255,255,0.9),
        0 0 30px rgba(0,255,255,0.5),
        0 0 60px rgba(0,255,255,0.25),
        0 0 80px rgba(0,255,255,0.1);
    }
  }
  @keyframes sheen {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
`;

export default function AuthGate({ open, onClose, onVerified, variant = "sheet" }) {
  const isRoot = variant === "root";
  const router = useRouter();
  const { applySessionUser } = useAuth();

  const [mode, setMode] = useState("signin"); // "signin" | "code"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [digits, setDigits] = useState(EMPTY_DIGITS);
  const [emailError, setEmailError] = useState("");
  const [formError, setFormError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);

  const inFlightRef = useRef(false);
  const verifyFlightRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const inputsRef = useRef([]);
  const touchStartYRef = useRef(null);
  const draggingRef = useRef(false);

  const code = useMemo(() => digits.join(""), [digits]);

  useEffect(() => {
    if (!open) {
      setMode("signin");
      setEmail(""); setPassword(""); setDigits(EMPTY_DIGITS());
      setEmailError(""); setFormError(""); setCodeError("");
      setLoading(false); setVerifying(false); setHasPhone(false);
      setSheetDragY(0);
      inFlightRef.current = false;
      verifyFlightRef.current = false;
      autoSubmittedRef.current = false;
    }
  }, [open]);

  // ── Step 1: email + password ──────────────────────────────────────────────
  const submitCredentials = async (e) => {
    e.preventDefault();
    setFormError(""); setEmailError("");
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) { setEmailError(emailCheck.error); return; }
    if (!password) { setFormError("Password is required"); return; }
    if (inFlightRef.current || loading) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login-step1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailCheck.value, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Login failed");
        return;
      }
      setHasPhone(Boolean(data.hasPhone));
      setDigits(EMPTY_DIGITS());
      autoSubmittedRef.current = false;
      setMode("code");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  // ── Digit input ───────────────────────────────────────────────────────────
  const updateDigit = (index, value) => {
    const char = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    setCodeError("");
    autoSubmittedRef.current = false;
    if (char && index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    const next = EMPTY_DIGITS();
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    setCodeError("");
    autoSubmittedRef.current = false;
    inputsRef.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  };

  // ── Step 2: verify code ───────────────────────────────────────────────────
  const submitCode = useCallback(async (e) => {
    e?.preventDefault?.();
    if (code.length !== CODE_LENGTH) { setCodeError("Enter the 6-digit code."); return; }
    if (verifyFlightRef.current || verifying) return;
    verifyFlightRef.current = true;
    setVerifying(true);
    setCodeError("");
    try {
      const res = await fetch("/api/auth/login-step2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.expired) {
          setMode("signin");
          setDigits(EMPTY_DIGITS());
          setPassword("");
        }
        setCodeError(data.error || "Verification failed");
        return;
      }
      if (data.session) {
        await applySessionUser(data.session);
      } else {
        const supabase = createClient();
        const { data: sd } = await supabase.auth.getSession();
        if (sd?.session) await applySessionUser(sd.session);
      }
      await onVerified?.();
    } catch {
      setCodeError("Something went wrong. Please try again.");
    } finally {
      verifyFlightRef.current = false;
      setVerifying(false);
    }
  }, [code, verifying, applySessionUser, onVerified]);

  // Auto-submit when all digits filled
  useEffect(() => {
    if (mode !== "code" || code.length !== CODE_LENGTH || verifying || verifyFlightRef.current || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    void submitCode();
  }, [code, mode, verifying, submitCode]);

  // ── Drag to dismiss (sheet variant) ──────────────────────────────────────
  const handleSheetTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    touchStartYRef.current = e.touches[0].clientY;
    draggingRef.current = true;
  };
  const handleSheetTouchMove = (e) => {
    if (!draggingRef.current || touchStartYRef.current == null) return;
    setSheetDragY(Math.max(0, e.touches[0].clientY - touchStartYRef.current));
  };
  const handleSheetTouchEnd = () => {
    if (sheetDragY >= DISMISS_DRAG_PX) onClose?.();
    setSheetDragY(0);
    touchStartYRef.current = null;
    draggingRef.current = false;
  };

  if (!open) return null;

  const cardStyle = {
    width: "min(440px, calc(100vw - 24px))",
    background: "#111",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: isRoot ? 20 : "20px 20px 0 0",
    padding: "28px 24px",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined,
    transition: sheetDragY > 0 ? "none" : "transform 0.25s ease",
    maxHeight: "92dvh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
  };

  const overlayStyle = isRoot ? {
    position: "fixed",
    inset: 0,
    zIndex: 9000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.85)",
    padding: 16,
  } : {
    position: "fixed",
    inset: 0,
    zIndex: 9000,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    background: "rgba(0,0,0,0.75)",
  };

  const wordmarkStyle = {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: "0.28em",
    color: "#fff",
    textAlign: "center",
    marginBottom: 20,
    background: "linear-gradient(90deg, #fff 0%, #00ffff 40%, #fff 60%, #00ffff 100%)",
    backgroundSize: "200% auto",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    animationName: "wordmarkGlow, sheen",
    animationDuration: "2.5s, 3s",
    animationTimingFunction: "ease-in-out, linear",
    animationIterationCount: "infinite, infinite",
  };

  return (
    <>
      <style>{GLOW_KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        style={overlayStyle}
        onClick={isRoot ? undefined : () => onClose?.()}
      >
        <div
          style={cardStyle}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={isRoot ? undefined : handleSheetTouchStart}
          onTouchMove={isRoot ? undefined : handleSheetTouchMove}
          onTouchEnd={isRoot ? undefined : handleSheetTouchEnd}
          onTouchCancel={isRoot ? undefined : handleSheetTouchEnd}
        >
          {!isRoot ? (
            <div style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: "rgba(255,255,255,0.2)",
              margin: "0 auto 20px",
              flexShrink: 0,
            }} />
          ) : null}
          <div style={wordmarkStyle}>2MRRW</div>

          {mode === "code" ? (
            <form onSubmit={submitCode} style={{ display: "flex", flexDirection: "column" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "white", fontFamily: "Georgia, serif" }}>
                Check your {hasPhone ? "email & phone" : "email"}
              </h2>
              <p style={{ margin: "0 0 20px", color: "#666", fontSize: 13, lineHeight: 1.6 }}>
                Enter the 6-digit code sent to {email}{hasPhone ? " and your phone" : ""}.
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { inputsRef.current[index] = el; }}
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => updateDigit(index, e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !digit && index > 0) {
                        inputsRef.current[index - 1]?.focus();
                      }
                    }}
                    aria-label={`Digit ${index + 1}`}
                    style={{
                      flex: "1 1 0",
                      minWidth: 0,
                      maxWidth: 44,
                      aspectRatio: "1",
                      height: "auto",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 10,
                      color: "white",
                      textAlign: "center",
                      fontSize: 18,
                      fontWeight: 700,
                      outline: "none",
                      boxSizing: "border-box",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              {codeError ? (
                <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{codeError}</div>
              ) : null}
              <button
                type="submit"
                disabled={verifying}
                style={{ ...ctaStyle, opacity: verifying ? 0.7 : 1 }}
              >
                {verifying ? "Verifying…" : "Verify"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setDigits(EMPTY_DIGITS());
                  setCodeError("");
                  autoSubmittedRef.current = false;
                }}
                style={linkStyle}
              >
                ← Back to sign in
              </button>
            </form>
          ) : (
            <form onSubmit={submitCredentials} style={{ display: "flex", flexDirection: "column" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "white", fontFamily: "Georgia, serif" }}>
                Welcome back
              </h2>
              <p style={{ margin: "0 0 16px", color: "#666", fontSize: 13, lineHeight: 1.6 }}>
                Enter your email and password to continue.
              </p>
              <input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                required
                style={{ ...inputStyle, borderColor: emailError ? "#ef4444" : "rgba(255,255,255,0.12)" }}
              />
              {emailError ? <div style={errorStyle}>{emailError}</div> : null}
              <input
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (formError) setFormError(""); }}
                required
                style={inputStyle}
              />
              {formError ? (
                <div style={{ ...errorStyle, marginTop: 0 }}>⚠ {formError}</div>
              ) : null}
              <button
                type="submit"
                disabled={loading}
                style={{ ...ctaStyle, opacity: loading ? 0.5 : 1, cursor: loading ? "default" : "pointer" }}
              >
                {loading ? "Verifying…" : "Continue"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/join")}
                style={linkStyle}
              >
                Create account
              </button>
              <button
                type="button"
                onClick={() => router.push("/forgot-password")}
                style={{ ...linkStyle, color: "#555", fontSize: 12, marginTop: 8 }}
              >
                Forgot password?
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
