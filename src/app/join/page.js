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
    <main className="auth-page">
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
          <h1 className="auth-heading">Join 2MRRW Music</h1>
          <p className="auth-subtext">Email + phone verification. No password.</p>
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
          {emailError ? (
            <div className="auth-error" style={{ marginTop: -4 }}>
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
            className={`auth-input${phoneError ? " auth-input--error" : ""}`}
            style={{ marginBottom: phoneError ? 8 : 12 }}
          />
          {phoneError ? (
            <div className="auth-error" style={{ marginTop: -4 }}>
              {phoneError}
            </div>
          ) : null}
          {error ? <div className="auth-error">⚠ {error}</div> : null}
          {existsHint ? (
            <Link
              href={giftToken ? `/login?gift=${giftToken}` : "/login"}
              className="auth-link"
              style={{ display: "block", marginTop: 0, marginBottom: 12 }}
            >
              Sign in instead →
            </Link>
          ) : null}
          <button type="submit" disabled={loading} className="auth-cta">
            {loading ? "Sending code…" : "Send Verification Code"}
          </button>
          <Link href="/" className="auth-link" style={{ opacity: 0.7 }}>
            Back to site
          </Link>
        </AuthScreenCard>
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="auth-page" />}>
      <JoinForm />
    </Suspense>
  );
}
