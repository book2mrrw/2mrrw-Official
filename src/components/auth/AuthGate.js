"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { writePendingPhone, clearPendingPhone, readPendingPhone } from "@/lib/auth/otp-pending";
import { validateEmail, validatePhone, formatResendCountdown } from "@/lib/auth/validation";
import { useAuth } from "@/context/AuthContext";
import AuthScreenCard from "@/components/auth/AuthScreenCard";

const DISMISS_DRAG_PX = 80;

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
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  const [sheetDragY, setSheetDragY] = useState(0);
  const inputsRef = useRef([]);
  const touchStartYRef = useRef(null);
  const draggingRef = useRef(false);
  const otpAutoSubmittedRef = useRef(false);

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
    setDigits(["", "", "", "", "", ""]);
    setOtpError("");
    setResendIn(30);
    setSheetDragY(0);
    touchStartYRef.current = null;
    draggingRef.current = false;
    otpAutoSubmittedRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open, resetForm]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const pendingEmail = sessionStorage.getItem("pendingOtpEmail");
    if (pendingEmail) {
      setEmail(pendingEmail);
      setOtpEmail(pendingEmail);
      setMode("otp");
      sessionStorage.removeItem("pendingOtpEmail");
    }
  }, [open]);

  useEffect(() => {
    if (screen !== "otp" || resendIn <= 0) return undefined;
    const timer = setInterval(() => setResendIn((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [screen, resendIn]);

  const sendOtpToEmail = useCallback(async (targetEmail, shouldCreateUser) => {
    const supabase = createClient();
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: { shouldCreateUser },
    });
    if (otpErr) throw otpErr;
    setOtpEmail(targetEmail);
    setOtpCreateUser(shouldCreateUser);
    setDigits(["", "", "", "", "", ""]);
    setResendIn(30);
    otpAutoSubmittedRef.current = false;
    setMode("otp");
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

    setLoading(true);
    try {
      writePendingPhone(phoneCheck.value);
      if (name.trim()) {
        sessionStorage.setItem("pendingProfileName", name.trim());
      }

      const exists = await checkEmailExists(emailCheck.value);
      await sendOtpToEmail(emailCheck.value, !exists);
    } catch (err) {
      if (/already|exists|registered/i.test(err.message || "")) {
        setFormError("You already have an account. Sign in instead.");
        setMode("signin");
        setEmail(email.trim());
      } else {
        setFormError(err.message || "Could not send verification code");
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
    if (!emailCheck.ok) {
      setEmailError(emailCheck.error);
      return;
    }

    setLoading(true);
    try {
      await sendOtpToEmail(emailCheck.value, false);
    } catch (err) {
      setFormError(err.message || "Could not send code");
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
    if (char && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const verifyOtp = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (code.length !== 6) {
        setOtpError("Enter the 6-digit code.");
        return;
      }
      setOtpLoading(true);
      setOtpError("");
      try {
        const supabase = createClient();
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          email: otpEmail,
          token: code,
          type: "email",
        });
        if (verifyError) throw verifyError;

        const pendingPhone = readPendingPhone() || undefined;
        const pendingName =
          typeof window !== "undefined" ? sessionStorage.getItem("pendingProfileName") : "";
        if (pendingPhone || pendingName) {
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
        setOtpError("Invalid or expired code. Try again.");
        otpAutoSubmittedRef.current = false;
      } finally {
        setOtpLoading(false);
      }
    },
    [code, otpEmail, name, applySessionUser, refreshAccountState, onVerified]
  );

  useEffect(() => {
    if (screen !== "otp" || code.length !== 6 || otpLoading || otpAutoSubmittedRef.current) return;
    otpAutoSubmittedRef.current = true;
    void verifyOtp();
  }, [screen, code, otpLoading, verifyOtp]);

  const resendOtp = async () => {
    if (resendIn > 0 || !otpEmail) return;
    setOtpError("");
    otpAutoSubmittedRef.current = false;
    try {
      await sendOtpToEmail(otpEmail, otpCreateUser);
    } catch (err) {
      setOtpError(err.message || "Could not resend code");
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
    if (sheetDragY >= DISMISS_DRAG_PX) {
      onClose();
    }
    setSheetDragY(0);
    touchStartYRef.current = null;
    draggingRef.current = false;
  };

  const signupReady = validateEmail(email).ok && validatePhone(phone).ok;
  const signinReady = validateEmail(email).ok;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={isRoot ? "auth-overlay auth-overlay--root auth-overlay--ref" : "auth-overlay auth-overlay--sheet"}
    >
      {!isRoot ? (
        <button type="button" aria-label="Close" onClick={onClose} className="auth-overlay-backdrop" />
      ) : null}
      <AuthScreenCard
        variant={variant}
        sheetDragY={sheetDragY}
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
        onTouchCancel={handleSheetTouchEnd}
      >
        {screen === "otp" ? (
          <form onSubmit={verifyOtp}>
            <h2 className="auth-heading auth-heading--elevated">Check your email</h2>
            <p className="auth-subtext">
              Enter the 6-digit code sent to {otpEmail || "your email"}.
            </p>
            <div className="auth-otp-row auth-otp-row--equal">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputsRef.current[index] = el;
                  }}
                  className={`auth-otp-box auth-otp-box--square auth-otp-box--focus-teal${digit ? " auth-otp-box--filled" : ""}`}
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => updateDigit(index, e.target.value)}
                  aria-label={`Digit ${index + 1}`}
                />
              ))}
            </div>
            {otpError ? <div className="auth-error">⚠ {otpError}</div> : null}
            <button type="submit" disabled={otpLoading} className="auth-cta">
              {otpLoading ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => void resendOtp()}
              disabled={resendIn > 0}
              className="auth-link"
              style={{ opacity: resendIn > 0 ? 0.85 : 1, cursor: resendIn > 0 ? "default" : "pointer" }}
            >
              {resendIn > 0 ? `Resend code in ${formatResendCountdown(resendIn)}` : "Resend code"}
            </button>
          </form>
        ) : screen === "signin" ? (
          <form onSubmit={submitSignin}>
            <h2 className="auth-heading auth-heading--elevated">Welcome back</h2>
            <p className="auth-subtext">Enter your email and we&apos;ll send a verification code.</p>
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              required
              className={`auth-input${emailError ? " auth-input--error" : ""}`}
              style={{ marginBottom: emailError ? 8 : 12 }}
            />
            {emailError ? <div className="auth-error" style={{ marginTop: -4 }}>{emailError}</div> : null}
            {formError ? <div className="auth-error">⚠ {formError}</div> : null}
            <button type="submit" disabled={loading || !signinReady} className="auth-cta">
              {loading ? "Sending…" : "Send Code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setFormError("");
              }}
              className="auth-link"
            >
              Create account
            </button>
          </form>
        ) : (
          <form onSubmit={submitSignup}>
            <h2 className="auth-heading auth-heading--elevated auth-heading--serif hero-title-glow">Join 2MRRW Music</h2>
            <p className="auth-subtext">
              Email verification. Phone is saved for your profile — no password.
            </p>
            <input
              placeholder="Full Name (optional)"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="auth-input"
              style={{ marginBottom: 12 }}
            />
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              required
              className={`auth-input${emailError ? " auth-input--error" : ""}`}
              style={{ marginBottom: emailError ? 8 : 12 }}
            />
            {emailError ? <div className="auth-error" style={{ marginTop: -4 }}>{emailError}</div> : null}
            <input
              placeholder="Phone number"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError("");
              }}
              required
              className={`auth-input${phoneError ? " auth-input--error" : ""}`}
              style={{ marginBottom: phoneError ? 8 : 12 }}
            />
            {phoneError ? <div className="auth-error" style={{ marginTop: -4 }}>{phoneError}</div> : null}
            {formError ? <div className="auth-error">⚠ {formError}</div> : null}
            <button type="submit" disabled={loading || !signupReady} className="auth-cta">
              {loading ? "Sending…" : "Send Verification Code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setFormError("");
                setEmailError("");
              }}
              className="auth-link"
            >
              Sign in
            </button>
          </form>
        )}
      </AuthScreenCard>
    </div>
  );
}
