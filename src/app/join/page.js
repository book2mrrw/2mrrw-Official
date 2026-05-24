"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { writePendingPhone } from "@/lib/auth/otp-pending";
import { validateEmail, validatePhone } from "@/lib/auth/validation";
import AuthScreenCard from "@/components/auth/AuthScreenCard";

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
        background: "#000",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420 }}>
        <AuthScreenCard variant="root">
          {giftPreview?.gift ? (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: "rgba(162,89,255,0.08)",
                border: "1px solid rgba(162,89,255,0.25)",
                marginBottom: 16,
              }}
            >
              <p style={{ margin: 0, fontSize: 13, color: "#c9b8ff", lineHeight: 1.6 }}>
                You have a gift waiting — create your account to claim it
                {giftPreview.gift.item_title ? `: ${giftPreview.gift.item_title}` : ""}.
              </p>
            </div>
          ) : null}
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: "1.5rem",
              fontWeight: "700",
              fontFamily: "Georgia,'Times New Roman',Times,serif",
              color: "#fff",
              textShadow:
                "0 0 14px rgba(0,255,255,0.55), 0 0 28px rgba(0,255,255,0.22)",
            }}
          >
            Join 2MRRW Music
          </h1>
          <p
            style={{
              margin: "0 0 20px",
              color: "#666",
              fontSize: "13px",
              lineHeight: "1.6",
            }}
          >
            Email + phone verification. No password.
          </p>
          <input
            placeholder="Full Name (optional)"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className=""
            style={{
              padding: "16px",
              background: "#1a1a1a",
              border: "1px solid #333",
              color: "#fff",
              borderRadius: "12px",
              fontSize: "14px",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
              marginBottom: "12px",
            }}
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
            className=""
            style={{
              padding: "16px",
              background: "#1a1a1a",
              border: emailError ? "1px solid #ff4444" : "1px solid #333",
              color: "#fff",
              borderRadius: "12px",
              fontSize: "14px",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
              marginBottom: emailError ? "8px" : "12px",
            }}
          />
          {emailError ? (
            <div
              style={{
                color: "#ff4444",
                fontSize: "12px",
                marginBottom: "8px",
                marginTop: "-4px",
              }}
            >
              {emailError}
            </div>
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
            className=""
            style={{
              padding: "16px",
              background: "#1a1a1a",
              border: phoneError ? "1px solid #ff4444" : "1px solid #333",
              color: "#fff",
              borderRadius: "12px",
              fontSize: "14px",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
              marginBottom: phoneError ? "8px" : "12px",
            }}
          />
          {phoneError ? (
            <div
              style={{
                color: "#ff4444",
                fontSize: "12px",
                marginBottom: "8px",
                marginTop: "-4px",
              }}
            >
              {phoneError}
            </div>
          ) : null}
          {error ? (
            <div
              style={{
                color: "#ff4444",
                fontSize: "12px",
                marginBottom: "8px",
              }}
            >
              ⚠ {error}
            </div>
          ) : null}
          {existsHint ? (
            <Link
              href={giftToken ? `/login?gift=${giftToken}` : "/login"}
              className=""
              style={{
                display: "block",
                textAlign: "center",
                marginTop: "0",
                marginBottom: "12px",
                fontSize: "13px",
                color: "#00b4b4",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              Sign in instead →
            </Link>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className=""
            style={{
              width: "100%",
              marginTop: "4px",
              padding: "16px 0",
              background: "#00b4b4",
              color: "#000",
              fontWeight: "700",
              border: "none",
              borderRadius: "12px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            {loading ? "Sending code…" : "Send Verification Code"}
          </button>
          <Link
            href={giftToken ? `/login?gift=${giftToken}` : "/login"}
            className=""
            style={{
              display: "block",
              textAlign: "center",
              marginTop: "12px",
              fontSize: "13px",
              color: "#00b4b4",
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            Sign in
          </Link>
        </AuthScreenCard>
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            background: "#000",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            boxSizing: "border-box",
          }}
        />
      }
    >
      <JoinForm />
    </Suspense>
  );
}
