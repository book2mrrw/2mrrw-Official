"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validateEmail } from "@/lib/auth/validation";

const inputStyle = {
  padding: "12px 14px",
  background: "#111",
  border: "1px solid #2a2a2a",
  color: "white",
  borderRadius: 10,
  fontSize: 14,
  outline: "none",
  width: "100%",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const giftToken = searchParams.get("gift") || "";
  const returnTo = searchParams.get("returnTo") || "";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [giftPreview, setGiftPreview] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (mounted && data?.user?.email && !data.user.email.endsWith("@guest.2mrrw.local")) {
          router.replace("/");
          return;
        }
      } catch {
        /* ignore */
      }
      if (mounted) setCheckingSession(false);
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!giftToken) return;
    fetch(`/api/gifts/preview/${giftToken}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.gift) setGiftPreview(data);
      })
      .catch(() => {});
  }, [giftToken]);

  const nextPath =
    giftToken ? `/gift/${giftToken}` : returnTo && returnTo.startsWith("/") ? returnTo : "/?tab=mymusic";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setEmailError("");

    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) {
      setEmailError(emailCheck.error);
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: emailCheck.value,
        options: { shouldCreateUser: false },
      });

      if (otpError) {
        if (/not found|no user|signups not allowed/i.test(otpError.message)) {
          setError("No account found. Create one here.");
        } else {
          setError(otpError.message);
        }
        return;
      }

      const params = new URLSearchParams({ email: emailCheck.value, next: nextPath });
      router.push(`/verify-otp?${params.toString()}`);
    } catch (err) {
      setError(err.message || "Could not send code");
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
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
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>
        {giftPreview?.gift ? (
          <p style={{ margin: 0, fontSize: 13, color: "#c9b8ff", lineHeight: 1.6 }}>
            Sign in to claim your gift{giftPreview.gift.item_title ? `: ${giftPreview.gift.item_title}` : ""}.
          </p>
        ) : null}
        <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Sign in</h1>
        <p style={{ margin: "0 0 8px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
          We&apos;ll email you a one-time code. No password.
        </p>
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
          {emailError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{emailError}</div> : null}
        </div>
        {error ? <div style={{ color: "#ff4d4d", fontSize: 13 }}>{error}</div> : null}
        {error?.includes("Create one") ? (
          <Link href={giftToken ? `/join?gift=${giftToken}` : "/join"} style={{ color: "#00ffff", fontSize: 13 }}>
            Create account →
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
          {loading ? "Sending…" : "Send Code"}
        </button>
        <Link href={giftToken ? `/join?gift=${giftToken}` : "/join"} style={{ color: "#777", fontSize: 13, textAlign: "center" }}>
          New here? Create account
        </Link>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#050505" }} />}>
      <LoginForm />
    </Suspense>
  );
}
