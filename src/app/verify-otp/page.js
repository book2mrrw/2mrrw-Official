"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearPendingPhone, readPendingPhone } from "@/lib/auth/otp-pending";
import { formatResendCountdown } from "@/lib/auth/validation";
import { useAuth } from "@/context/AuthContext";

const OTP_LENGTH = 8;
const EMPTY_DIGITS = () => Array(OTP_LENGTH).fill("");

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applySessionUser, refreshAccountState } = useAuth();
  const email = (searchParams.get("email") || "").trim();
  const nextPath = searchParams.get("next") || "/?tab=mymusic";
  const shouldCreateUser = searchParams.get("createUser") !== "0";

  const [digits, setDigits] = useState(EMPTY_DIGITS);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  const inputsRef = useRef([]);
  const otpAutoSubmittedRef = useRef(false);
  const completeProfileFetchedRef = useRef(false);

  const code = useMemo(() => digits.join(""), [digits]);

  useEffect(() => {
    if (!email) router.replace("/join");
  }, [email, router]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setInterval(() => setResendIn((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

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
      setOtpLoading(true);
      setOtpError("");
      try {
        const supabase = createClient();
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: "email",
        });
        if (verifyError) throw verifyError;

        const pendingPhone = readPendingPhone() || undefined;
        const pendingName =
          typeof window !== "undefined" ? sessionStorage.getItem("pendingProfileName") : "";
        if ((pendingPhone || pendingName) && !completeProfileFetchedRef.current) {
          completeProfileFetchedRef.current = true;
          try {
            await fetch("/api/auth/complete-profile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ email, phone: pendingPhone, name: pendingName || undefined }),
            });
          } catch {
            /* profile sync is best-effort; OTP session still valid */
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
        router.push(nextPath);
        router.refresh();
      } catch {
        setOtpError("Invalid or expired code. Try again.");
        otpAutoSubmittedRef.current = false;
      } finally {
        setOtpLoading(false);
      }
    },
    [code, email, applySessionUser, refreshAccountState, router, nextPath]
  );

  useEffect(() => {
    if (code.length !== OTP_LENGTH || otpLoading || otpAutoSubmittedRef.current) return;
    otpAutoSubmittedRef.current = true;
    void verifyOtp();
  }, [code, otpLoading, verifyOtp]);

  const resendOtp = async () => {
    if (resendIn > 0 || !email) return;
    setOtpError("");
    otpAutoSubmittedRef.current = false;
    try {
      const supabase = createClient();
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser },
      });
      if (otpErr) throw otpErr;
      setDigits(EMPTY_DIGITS());
      setResendIn(30);
    } catch (err) {
      setOtpError(err.message || "Could not resend code");
    }
  };

  if (!email) {
    return <main style={{ minHeight: "100vh", background: "#050505" }} />;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#050505",
        color: "white",
        display: "grid",
        placeItems: "center",
        padding: 24,
        fontFamily: "sans-serif",
      }}
    >
      <form
        onSubmit={verifyOtp}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0d0d0d",
          border: "1px solid #222",
          borderRadius: 20,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: 6,
          color: "#00ffff",
        }}>
          2MRRW
        </div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Check your email</h1>
        <p style={{ margin: 0, color: "#888", fontSize: 13, lineHeight: 1.6 }}>
          Enter the 8-digit code we sent to {email}
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "nowrap",
            width: "100%",
            gap: 6,
          }}
        >
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
              aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                maxWidth: 44,
                aspectRatio: "1",
                height: "auto",
                background: "#111",
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                color: "white",
                textAlign: "center",
                fontSize: 20,
                fontWeight: 700,
                outline: "none",
                boxSizing: "border-box",
                padding: 0,
              }}
            />
          ))}
        </div>
        {otpError ? (
          <div style={{ color: "#ef4444", fontSize: 12 }}>
            {otpError}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={otpLoading}
          style={{
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
            background: "none",
            border: "none",
            color: "#00ffff",
            fontSize: 13,
            textAlign: "center",
            cursor: resendIn > 0 ? "default" : "pointer",
            opacity: resendIn > 0 ? 0.5 : 1,
            padding: 0,
          }}
        >
          {resendIn > 0 ? `Resend code in ${formatResendCountdown(resendIn)}` : "Resend code"}
        </button>
        <Link
          href="/join"
          style={{
            color: "#777",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          Back
        </Link>
      </form>
    </main>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#050505" }} />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
