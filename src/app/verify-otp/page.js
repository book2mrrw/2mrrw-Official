"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearPendingPhone, readPendingPhone } from "@/lib/auth/otp-pending";
import { formatResendCountdown } from "@/lib/auth/validation";
import { useAuth } from "@/context/AuthContext";
import AuthScreenCard from "@/components/auth/AuthScreenCard";

/** UI expects 8 digits; set Supabase Auth email OTP length to 8 (default is 6). */
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

  const code = useMemo(() => digits.join(""), [digits]);

  useEffect(() => {
    if (!email) {
      router.replace("/join");
    }
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
        if (pendingPhone || pendingName) {
          await fetch("/api/auth/complete-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              email,
              phone: pendingPhone,
              name: pendingName || undefined,
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
    return <main className="auth-page auth-page--ref" />;
  }

  return (
    <main className="auth-page auth-page--ref">
      <form onSubmit={verifyOtp} style={{ width: "100%", maxWidth: 420 }}>
        <AuthScreenCard variant="root">
          <h1 className="auth-heading auth-heading--elevated hero-title-glow">Check your email</h1>
          <p className="auth-subtext">
            Enter the 8-digit code we sent to {email}
          </p>
          <div className="auth-otp-row auth-otp-row-8">
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
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !digit && index > 0) {
                    inputsRef.current[index - 1]?.focus();
                  }
                }}
                aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
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
          <Link href="/join" className="auth-link" style={{ opacity: 0.7 }}>
            Back
          </Link>
        </AuthScreenCard>
      </form>
    </main>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<main className="auth-page auth-page--ref" />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
