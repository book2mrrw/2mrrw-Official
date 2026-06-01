
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  verifyEmailOtp,
  sendEmailOtp,
  formatOtpSendError,
  getOtpCooldownRemainingMs,
  resetOtpEmailIntent,
  normalizeAuthEmail,
} from "@/auth/authService";
import { writePendingPhone, clearPendingPhone, readPendingPhone } from "@/lib/auth/otp-pending";
import { validateEmail, validatePhone, formatResendCountdown } from "@/lib/auth/validation";
import { useAuth } from "@/context/AuthContext";
const DISMISS_DRAG_PX = 80;
const OTP_LENGTH = 8;
const EMPTY_DIGITS = () => Array(OTP_LENGTH).fill("");
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
  const { applySessionUser, refreshAccountState } = useAuth();
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCreateUser, setOtpCreateUser] = useState(true);
  const [digits, setDigits] = useState(EMPTY_DIGITS());
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [otpAwaitingEntry, setOtpAwaitingEntry] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const inputsRef = useRef([]);
  const touchStartYRef = useRef(null);
  const draggingRef = useRef(false);
  const otpAutoSubmittedRef = useRef(false);
  const otpSendInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);
  const completeProfileFetchedRef = useRef(false);
  const otpRequestIdRef = useRef(null);
  const code = useMemo(() => digits.join(""), [digits]);
  const screen = mode === "otp" ? "otp" : mode === "signin" ? "signin" : "signup";
  const resetForm = useCallback(() => {
    setMode("signup");
    setName("");
    setEmail("");
    setPhone("");
    setEmailError("");
    setPhoneError("");
    setFormError("");
    setOtpEmail("");
    setDigits(EMPTY_DIGITS());
    setOtpError("");
    setOtpSending(false);
    setOtpAwaitingEntry(false);
    setResendIn(0);
    setSheetDragY(0);
    otpSendInFlightRef.current = false;
    verifyInFlightRef.current = false;
    touchStartYRef.current = null;
    draggingRef.current = false;
    otpAutoSubmittedRef.current = false;
    otpRequestIdRef.current = null;
  }, []);
  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const pendingEmail = sessionStorage.getItem("pendingOtpEmail");
    if (pendingEmail) {
      setEmail(pendingEmail);
      setOtpEmail(pendingEmail);
      setMode("otp");
      setOtpAwaitingEntry(true);
      sessionStorage.removeItem("pendingOtpEmail");
    }
  }, [open]);
  useEffect(() => {
    if (screen !== "otp" || !otpEmail) return undefined;
    const syncCooldown = () => {
      setResendIn(Math.ceil(getOtpCooldownRemainingMs(otpEmail) / 1000));
    };
    syncCooldown();
    const timer = setInterval(syncCooldown, 500);
    return () => clearInterval(timer);
  }, [screen, otpEmail]);
  const handleEmailChange = (next) => {
    if (normalizeAuthEmail(next) !== normalizeAuthEmail(email)) {
      resetOtpEmailIntent(email, { requestId: otpRequestIdRef.current });
      otpRequestIdRef.current = null;
      otpSendInFlightRef.current = false;
      setLoading(false);
      setOtpSending(false);
    }
    setEmail(next);
    if (emailError) setEmailError("");
  };
  const sendOtpToEmail = useCallback(async (targetEmail, shouldCreateUser) => {
    if (otpSendInFlightRef.current) return;
    otpSendInFlightRef.current = true;
    setOtpSending(true);
    setOtpError("");
    try {
      if (!otpRequestIdRef.current) {
        otpRequestIdRef.current =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      const { error: otpErr, deduplicated, cooldownMs } = await sendEmailOtp({
        email: targetEmail,
        shouldCreateUser,
        requestId: otpRequestIdRef.current,
      });
      if (otpErr && !deduplicated) {
        if (cooldownMs > 0) {
          throw new Error("Please wait before requesting another code.");
        }
        throw otpErr;
      }
      setOtpEmail(targetEmail);
      setOtpCreateUser(shouldCreateUser);
      setDigits(EMPTY_DIGITS());
      setOtpAwaitingEntry(false);
      otpAutoSubmittedRef.current = false;
      setMode("otp");
    } finally {
      otpRequestIdRef.current = null;
      otpSendInFlightRef.current = false;
      setOtpSending(false);
    }
  }, []);
  const checkEmailExists = useCallback(async (targetEmail) => {
    const res = await fetch("/api/auth/lookup-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail }),
    });
    const data = await res.json();
    if (!res.ok) return false;
    return Boolean(data.exists);
  }, []);
  const submitSignup = async (e) => {
    e.preventDefault();
    setFormError("");
    setEmailError("");
    setPhoneError("");
    const emailCheck = validateEmail(email);
    const phoneCheck = validatePhone(phone);
    if (!emailCheck.ok) setEmailError(emailCheck.error);
    if (!phoneCheck.ok) setPhoneError(phoneCheck.error);
    if (!emailCheck.ok || !phoneCheck.ok) return;
    if (loading || otpSending) return;
    setLoading(true);
    try {
      writePendingPhone(phoneCheck.value);
      if (name.trim()) sessionStorage.setItem("pendingProfileName", name.trim());
      const exists = await checkEmailExists(emailCheck.value);
      await sendOtpToEmail(emailCheck.value, !exists);
    } catch (err) {
      if (/already|exists|registered/i.test(err.message || "")) {
        setFormError("You already have an account. Sign in instead.");
        setMode("signin");
        setEmail(email.trim());
      } else {
        setFormError(formatOtpSendError(err));
      }
    } finally {
      setLoading(false);
    }
  };
  const submitSignin = async (e) => {
    e.preventDefault();
    setFormError("");
    setEmailError("");
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) { setEmailError(emailCheck.error); return; }
    if (loading || otpSending) return;
    setLoading(true);
    try {
      await sendOtpToEmail(emailCheck.value, false);
    } catch (err) {
      setFormError(formatOtpSendError(err));
    } finally {
      setLoading(false);
    }
  };
  const updateDigit = (index, value) => {
    const char = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    setOtpError("");
    otpAutoSubmittedRef.current = false;
    if (char && index < OTP_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };
  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = EMPTY_DIGITS();
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
    setDigits(next);
    setOtpError("");
    otpAutoSubmittedRef.current = false;
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    inputsRef.current[focusIndex]?.focus();
  };
  const verifyOtp = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (code.length !== OTP_LENGTH) {
        setOtpError("Enter the 8-digit code.");
        return;
      }
      if (verifyInFlightRef.current || otpLoading) return;
      verifyInFlightRef.current = true;
      setOtpLoading(true);
      setOtpError("");
      try {
        const { data, error: verifyError } = await verifyEmailOtp({
          email: otpEmail,
          token: code,
          type: "email",
        });
        if (verifyError) throw verifyError;
        const pendingPhone = readPendingPhone() || undefined;
        const pendingName =
          typeof window !== "undefined"
            ? sessionStorage.getItem("pendingProfileName")
            : "";
        if ((pendingPhone || pendingName) && !completeProfileFetchedRef.current) {
          completeProfileFetchedRef.current = true;
          try {
            await fetch("/api/auth/complete-profile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                email: otpEmail,
                phone: pendingPhone,
                name: pendingName || name.trim() || undefined,
              }),
            });
          } catch {
            /* profile sync is best-effort */
          }
        }
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("pendingProfileName");
        }
        clearPendingPhone();
        if (data?.session) {
          await applySessionUser(data.session);
        } else if (data?.user) {
          await applySessionUser({ user: data.user });
        }
        await refreshAccountState();
        await onVerified?.();
      } catch {
        setOtpError("Invalid or expired code. Try again or tap Resend code.");
      } finally {
        verifyInFlightRef.current = false;
        setOtpLoading(false);
      }
    },
    [code, otpEmail, name, applySessionUser, refreshAccountState, onVerified, otpLoading]
  );
  useEffect(() => {
    if (
      screen !== "otp" ||
      code.length !== OTP_LENGTH ||
      otpLoading ||
      verifyInFlightRef.current ||
      otpAutoSubmittedRef.current
    ) return;
    otpAutoSubmittedRef.current = true;
    void verifyOtp();
  }, [screen, code, otpLoading, verifyOtp]);
  const resendOtp = async () => {
    if (
      getOtpCooldownRemainingMs(otpEmail) > 0 ||
      resendIn > 0 ||
      !otpEmail ||
      otpSending
    ) {
      return;
    }
    setOtpError("");
    otpAutoSubmittedRef.current = false;
    try {
      await sendOtpToEmail(otpEmail, otpCreateUser);
    } catch (err) {
      setOtpError(formatOtpSendError(err));
    }
  };
  const handleSheetTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    touchStartYRef.current = e.touches[0].clientY;
    draggingRef.current = true;
  };
  const handleSheetTouchMove = (e) => {
    if (!draggingRef.current || touchStartYRef.current == null) return;
    const delta = Math.max(0, e.touches[0].clientY - touchStartYRef.current);
    setSheetDragY(delta);
  };
  const handleSheetTouchEnd = () => {
    if (sheetDragY >= DISMISS_DRAG_PX) onClose();
    setSheetDragY(0);
    touchStartYRef.current = null;
    draggingRef.current = false;
  };
  const signupReady = validateEmail(email).ok && validatePhone(phone).ok;
  const signinReady = validateEmail(email).ok;
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
        onClick={isRoot ? undefined : onClose}
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
          {screen === "otp" ? (
            <form onSubmit={verifyOtp} style={{ display: "flex", flexDirection: "column" }}>
              <h2 style={{
                margin: "0 0 8px",
                fontSize: 22,
                fontWeight: 700,
                color: "white",
                fontFamily: "Georgia, serif",
              }}>
                Check your email
              </h2>
              <p style={{
                margin: "0 0 20px",
                color: "#666",
                fontSize: 13,
                lineHeight: 1.6,
              }}>
                {otpAwaitingEntry
                  ? `Enter the code we already sent to ${otpEmail || "your email"}, or tap Resend code.`
                  : `Enter the 8-digit code sent to ${otpEmail || "your email"}.`}
              </p>
              <div style={{
                display: "flex",
                flexDirection: "row",
                flexWrap: "nowrap",
                width: "100%",
                gap: 5,
                marginBottom: 16,
              }}>
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
                      maxWidth: 40,
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
              {otpError ? (
                <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>
                  {otpError}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={otpLoading}
                style={{ ...ctaStyle, opacity: otpLoading ? 0.7 : 1 }}
              >
                {otpLoading ? "Verifying…" : "Verify"}
              </button>
              <button
                type="button"
                onClick={() => void resendOtp()}
                disabled={resendIn > 0 || otpSending}
                style={{
                  ...linkStyle,
                  opacity: resendIn > 0 || otpSending ? 0.5 : 1,
                  cursor: resendIn > 0 || otpSending ? "default" : "pointer",
                }}
              >
                {otpSending
                  ? "Sending…"
                  : resendIn > 0
                    ? `Resend code in ${formatResendCountdown(resendIn)}`
                    : "Resend code"}
              </button>
            </form>
          ) : screen === "signin" ? (
            <form onSubmit={submitSignin} style={{ display: "flex", flexDirection: "column" }}>
              <h2 style={{
                margin: "0 0 8px",
                fontSize: 22,
                fontWeight: 700,
                color: "white",
                fontFamily: "Georgia, serif",
              }}>
                Welcome back
              </h2>
              <p style={{
                margin: "0 0 16px",
                color: "#666",
                fontSize: 13,
                lineHeight: 1.6,
              }}>
                Enter your email and we&apos;ll send a verification code.
              </p>
              <input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                required
                style={{
                  ...inputStyle,
                  borderColor: emailError ? "#ef4444" : "rgba(255,255,255,0.12)",
                }}
              />
              {emailError ? <div style={errorStyle}>{emailError}</div> : null}
              {formError ? (
                <div style={{ ...errorStyle, marginTop: 0 }}>⚠ {formError}</div>
              ) : null}
              <button
                type="submit"
                disabled={loading || otpSending || !signinReady}
                style={{
                  ...ctaStyle,
                  opacity: loading || otpSending || !signinReady ? 0.5 : 1,
                  cursor: loading || otpSending || !signinReady ? "default" : "pointer",
                }}
              >
                {loading || otpSending ? "Sending…" : "Send Code"}
              </button>
              <button
                type="button"
                onClick={() => { setMode("signup"); setFormError(""); }}
                style={linkStyle}
              >
                Create account
              </button>
            </form>
          ) : (
            <form onSubmit={submitSignup} style={{ display: "flex", flexDirection: "column" }}>
              <h2 style={{
                margin: "0 0 8px",
                fontSize: 22,
                fontWeight: 700,
                color: "white",
                fontFamily: "Georgia, serif",
              }}>
                Join 2MRRW Music
              </h2>
              <p style={{
                margin: "0 0 16px",
                color: "#666",
                fontSize: 13,
                lineHeight: 1.6,
              }}>
                Email verification. Phone is saved for your profile — no password.
              </p>
              <input
                placeholder="Full Name (optional)"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                required
                style={{
                  ...inputStyle,
                  borderColor: emailError ? "#ef4444" : "rgba(255,255,255,0.12)",
                }}
              />
              {emailError ? <div style={errorStyle}>{emailError}</div> : null}
              <input
                placeholder="Phone number"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (phoneError) setPhoneError("");
                }}
                required
                style={{
                  ...inputStyle,
                  borderColor: phoneError ? "#ef4444" : "rgba(255,255,255,0.12)",
                }}
              />
              {phoneError ? <div style={errorStyle}>{phoneError}</div> : null}
              {formError ? (
                <div style={{ ...errorStyle, marginTop: 0 }}>⚠ {formError}</div>
              ) : null}
              <button
                type="submit"
                disabled={loading || otpSending || !signupReady}
                style={{
                  ...ctaStyle,
                  opacity: loading || otpSending || !signupReady ? 0.5 : 1,
                  cursor: loading || otpSending || !signupReady ? "default" : "pointer",
                }}
              >
                {loading || otpSending ? "Sending…" : "Send Verification Code"}
              </button>
              <button
                type="button"
                onClick={() => { setMode("signin"); setFormError(""); setEmailError(""); }}
                style={linkStyle}
              >
                Sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}