"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { writePendingPhone, clearPendingPhone, readPendingPhone } from "@/lib/auth/otp-pending";
import { validateEmail, validatePhone, formatResendCountdown } from "@/lib/auth/validation";
import { isAdminUser } from "@/lib/auth/constants";
import { useAuth } from "@/context/AuthContext";

const DISMISS_DRAG_PX = 80;

const inputStyle = {
  padding: "12px 14px",
  background: "#111",
  border: "1px solid #2a2a2a",
  color: "white",
  borderRadius: 10,
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const otpBoxStyle = {
  width: 44,
  height: 52,
  textAlign: "center",
  fontSize: 22,
  fontWeight: 800,
  background: "#111",
  border: "1px solid #2a2a2a",
  color: "white",
  borderRadius: 10,
};

export default function AuthGate({ open, onClose, onVerified }) {
  const { markAdmin } = useAuth();
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
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open, resetForm]);

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
    if (char && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
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

      const verifiedUser = data?.user || data?.session?.user;
      if (verifiedUser && isAdminUser(verifiedUser)) {
        markAdmin(verifiedUser);
      }

      await onVerified?.();
    } catch {
      setOtpError("Invalid or expired code. Try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  const resendOtp = async () => {
    if (resendIn > 0 || !otpEmail) return;
    setOtpError("");
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
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.75)",
          border: "none",
          cursor: "pointer",
        }}
      />
      <div
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
        onTouchCancel={handleSheetTouchEnd}
        style={{
          position: "relative",
          background: "#111",
          borderRadius: "20px 20px 0 0",
          padding: "12px 24px 32px",
          maxHeight: "90vh",
          overflowY: "auto",
          transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined,
          transition: sheetDragY > 0 ? "none" : "transform 0.2s ease",
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: "#333",
            margin: "0 auto 20px",
          }}
        />

        {screen === "otp" ? (
          <form onSubmit={verifyOtp}>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>Check your email</h2>
            <p style={{ margin: "0 0 20px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
              Enter the 6-digit code we sent to {otpEmail || "your email"}.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 20 }}>
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputsRef.current[index] = el;
                  }}
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => updateDigit(index, e.target.value)}
                  style={otpBoxStyle}
                />
              ))}
            </div>
            {otpError ? (
              <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{otpError}</div>
            ) : null}
            <button
              type="submit"
              disabled={otpLoading}
              style={{
                width: "100%",
                padding: "13px 0",
                background: "#00ffff",
                color: "#000",
                fontWeight: 900,
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                opacity: otpLoading ? 0.7 : 1,
              }}
            >
              {otpLoading ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => void resendOtp()}
              disabled={resendIn > 0}
              style={{
                marginTop: 14,
                background: "none",
                border: "none",
                color: "#00ffff",
                fontSize: 13,
                cursor: resendIn > 0 ? "default" : "pointer",
                width: "100%",
                opacity: resendIn > 0 ? 0.85 : 1,
              }}
            >
              {resendIn > 0 ? `Resend code in ${formatResendCountdown(resendIn)}` : "Resend code"}
            </button>
          </form>
        ) : screen === "signin" ? (
          <form onSubmit={submitSignin}>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>Welcome back</h2>
            <p style={{ margin: "0 0 20px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
              Enter your email and we&apos;ll send a verification code.
            </p>
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              required
              style={{ ...inputStyle, borderColor: emailError ? "#ef4444" : "#2a2a2a", marginBottom: 8 }}
            />
            {emailError ? (
              <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{emailError}</div>
            ) : null}
            {formError ? (
              <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{formError}</div>
            ) : null}
            <button
              type="submit"
              disabled={loading || !signinReady}
              style={{
                width: "100%",
                padding: "13px 0",
                background: "#00ffff",
                color: "#000",
                fontWeight: 900,
                border: "none",
                borderRadius: 10,
                cursor: signinReady && !loading ? "pointer" : "not-allowed",
                opacity: loading || !signinReady ? 0.5 : 1,
              }}
            >
              {loading ? "Sending…" : "Send Code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setFormError("");
              }}
              style={{
                marginTop: 16,
                background: "none",
                border: "none",
                color: "#00ffff",
                fontSize: 13,
                cursor: "pointer",
                width: "100%",
              }}
            >
              Create account
            </button>
          </form>
        ) : (
          <form onSubmit={submitSignup}>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>Join 2MRRW</h2>
            <p style={{ margin: "0 0 20px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
              Email verification. Phone is saved for your profile — no password.
            </p>
            <input
              placeholder="Full Name (optional)"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ ...inputStyle, marginBottom: 12 }}
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
              style={{ ...inputStyle, borderColor: emailError ? "#ef4444" : "#2a2a2a", marginBottom: 8 }}
            />
            {emailError ? (
              <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{emailError}</div>
            ) : null}
            <input
              placeholder="Phone number"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError("");
              }}
              required
              style={{ ...inputStyle, borderColor: phoneError ? "#ef4444" : "#2a2a2a", marginBottom: 8 }}
            />
            {phoneError ? (
              <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{phoneError}</div>
            ) : null}
            {formError ? (
              <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{formError}</div>
            ) : null}
            <button
              type="submit"
              disabled={loading || !signupReady}
              style={{
                width: "100%",
                padding: "13px 0",
                background: "#00ffff",
                color: "#000",
                fontWeight: 900,
                border: "none",
                borderRadius: 10,
                cursor: signupReady && !loading ? "pointer" : "not-allowed",
                opacity: loading || !signupReady ? 0.5 : 1,
              }}
            >
              {loading ? "Sending…" : "Send Verification Code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setFormError("");
                setEmailError("");
              }}
              style={{
                marginTop: 16,
                background: "none",
                border: "none",
                color: "#00ffff",
                fontSize: 13,
                cursor: "pointer",
                width: "100%",
              }}
            >
              Sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
