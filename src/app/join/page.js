"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { writePendingPhone } from "@/lib/auth/otp-pending";
import { validateEmail, validatePhone } from "@/lib/auth/validation";

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

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const giftToken = searchParams.get("gift") || "";
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [existsHint, setExistsHint] = useState(false);
  const [giftPreview, setGiftPreview] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingEmail = sessionStorage.getItem("pendingJoinEmail");
    const pendingPhone = sessionStorage.getItem("pendingJoinPhone");
    if (pendingEmail) {
      setEmail(pendingEmail);
      sessionStorage.removeItem("pendingJoinEmail");
    }
    if (pendingPhone) {
      setPhone(pendingPhone);
      sessionStorage.removeItem("pendingJoinPhone");
    }
    const pendingName = sessionStorage.getItem("pendingProfileName");
    if (pendingName) {
      setName(pendingName);
    }
  }, []);

  useEffect(() => {
    if (!giftToken) return;
    fetch(`/api/gifts/preview/${giftToken}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.gift) setGiftPreview(data);
      })
      .catch(() => {});
  }, [giftToken]);

  const nextPath = giftToken ? `/gift/${giftToken}` : "/?tab=mymusic";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setEmailError("");
    setPhoneError("");
    setExistsHint(false);

    const emailCheck = validateEmail(email);
    const phoneCheck = validatePhone(phone);
    if (!emailCheck.ok) {
      setEmailError(emailCheck.error);
    }
    if (!phoneCheck.ok) {
      setPhoneError(phoneCheck.error);
    }
    if (!emailCheck.ok || !phoneCheck.ok) return;

    setLoading(true);

    try {
      writePendingPhone(phoneCheck.value);
      if (name.trim()) {
        sessionStorage.setItem("pendingProfileName", name.trim());
      }
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: emailCheck.value,
        options: { shouldCreateUser: true },
      });

      if (otpError) {
        if (/already|exists|registered/i.test(otpError.message)) {
          setExistsHint(true);
          setError("You already have an account. Sign in instead.");
        } else {
          setError(otpError.message);
        }
        return;
      }

      const params = new URLSearchParams({
        email: emailCheck.value,
        next: nextPath,
      });
      router.push(`/verify-otp?${params.toString()}`);
    } catch (err) {
      setError(err.message || "Could not send code");
    } finally {
      setLoading(false);
    }
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
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0d0d0d",
          border: "1px solid #222",
          borderRadius: 20,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 12,
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
        {giftPreview?.gift ? (
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: "rgba(162,89,255,0.08)",
              border: "1px solid rgba(162,89,255,0.25)",
              marginBottom: 4,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: "#c9b8ff", lineHeight: 1.6 }}>
              You have a gift waiting — create your account to claim it
              {giftPreview.gift.item_title ? `: ${giftPreview.gift.item_title}` : ""}.
            </p>
          </div>
        ) : null}
        <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Join 2MRRW</h1>
        <p style={{ margin: "0 0 8px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
          Email + phone verification. No password.
        </p>
        <input
          placeholder="Full Name (optional)"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
        <div>
          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError("");
            }}
            required
            style={{ ...inputStyle, borderColor: emailError ? "#ef4444" : "#2a2a2a" }}
          />
          {emailError ? (
            <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>
              {emailError}
            </div>
          ) : null}
        </div>
        <div>
          <input
            placeholder="Phone number"
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneError) setPhoneError("");
            }}
            required
            style={{ ...inputStyle, borderColor: phoneError ? "#ef4444" : "#2a2a2a" }}
          />
          {phoneError ? (
            <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>
              {phoneError}
            </div>
          ) : null}
        </div>
        {error ? (
          <div style={{ color: "#ff4d4d", fontSize: 13 }}>
            {error}
          </div>
        ) : null}
        {existsHint ? (
          <Link
            href={giftToken ? `/login?gift=${giftToken}` : "/login"}
            style={{ color: "#00ffff", fontSize: 13 }}
          >
            Sign in instead →
          </Link>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          style={{
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
          {loading ? "Sending code…" : "Send Verification Code"}
        </button>
        <Link
          href={giftToken ? `/login?gift=${giftToken}` : "/login"}
          style={{ color: "#00ffff", fontSize: 13, textAlign: "center", marginTop: 4 }}
        >
          Sign in
        </Link>
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#050505" }} />}>
      <JoinForm />
    </Suspense>
  );
}
