"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearPendingPhone, readPendingPhone } from "@/lib/auth/otp-pending";
import { useAuth } from "@/context/AuthContext";

const boxStyle = {
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

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshAccountState } = useAuth();
  const email = searchParams.get("email") || "";
  const nextPath = searchParams.get("next") || "/?tab=mymusic";
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(30);
  const inputsRef = useRef([]);

  const code = useMemo(() => digits.join(""), [digits]);

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
    if (char && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const verify = async (e) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (verifyError) throw verifyError;

      const phone = readPendingPhone();
      if (phone) {
        await fetch("/api/auth/complete-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, phone }),
        });
      }
      clearPendingPhone();
      await refreshAccountState();
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      setError("Invalid or expired code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setError("");
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({ email });
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setResendIn(30);
  };

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
        onSubmit={verify}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0d0d0d",
          border: "1px solid #222",
          borderRadius: 20,
          padding: 28,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff", marginBottom: 12 }}>2MRRW</div>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Verify code</h1>
        <p style={{ margin: "0 0 20px", color: "#888", fontSize: 14 }}>Sent to {email}</p>
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
              style={boxStyle}
            />
          ))}
        </div>
        {error ? <div style={{ color: "#ff4d4d", fontSize: 13, marginBottom: 12 }}>{error}</div> : null}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "13px 0",
            background: "#00ffff",
            color: "#000",
            fontWeight: 900,
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Verifying…" : "Verify"}
        </button>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resendIn > 0}
          style={{
            marginTop: 14,
            background: "none",
            border: "none",
            color: resendIn > 0 ? "#555" : "#00ffff",
            fontSize: 13,
            cursor: resendIn > 0 ? "default" : "pointer",
            width: "100%",
          }}
        >
          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
        </button>
        <Link href="/join" style={{ display: "block", color: "#777", fontSize: 13, textAlign: "center", marginTop: 16 }}>
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
