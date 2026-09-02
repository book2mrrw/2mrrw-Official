"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuthenticatedUser } from "@/auth/authService";
import { useAuth } from "@/context/AuthContext";
import { validateEmail } from "@/lib/auth/validation";
import { sanitizeReturnTo } from "@/lib/auth/route-access-policy";
import { createClient } from "@/lib/supabase/client";

const CODE_LENGTH = 6;
const EMPTY_DIGITS = () => Array(CODE_LENGTH).fill("");

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
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { applySessionUser } = useAuth();
  const giftToken    = searchParams.get("gift")     || "";
  const returnTo     = searchParams.get("returnTo") || "";

  const [mode,          setMode]          = useState("credentials"); // "credentials" | "code"
  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [digits,        setDigits]        = useState(EMPTY_DIGITS);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [emailError,    setEmailError]    = useState("");
  const [hasPhone,      setHasPhone]      = useState(false);
  const [checkingAuth,  setCheckingAuth]  = useState(true);
  const [giftPreview,   setGiftPreview]   = useState(null);

  const inFlightRef     = useRef(false);
  const verifyFlightRef = useRef(false);
  const autoSubmitRef   = useRef(false);
  const inputsRef       = useRef([]);

  const nextPath = giftToken
    ? `/gift/${encodeURIComponent(giftToken)}`
    : sanitizeReturnTo(returnTo, "/?tab=mymusic");
  const createAccountHref = giftToken
    ? `/join?gift=${encodeURIComponent(giftToken)}`
    : `/join?returnTo=${encodeURIComponent(nextPath)}`;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getAuthenticatedUser();
        if (mounted && user?.email) {
          const stateRes = await fetch("/api/auth/mfa-session", {
            credentials: "include",
            cache: "no-store",
          });
          const state = stateRes.ok ? await stateRes.json() : null;
          if (state?.admin && state?.mfaRequired) {
            setEmail(user.email);
          } else {
            router.replace("/");
            return;
          }
        }
      } catch {}
      if (mounted) setCheckingAuth(false);
    })();
    return () => { mounted = false; };
  }, [router]);

  useEffect(() => {
    if (!giftToken) return;
    fetch(`/api/gifts/preview/${giftToken}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (d?.gift) setGiftPreview(d); })
      .catch(() => {});
  }, [giftToken]);

  // ── Step 1: email + password ──────────────────────────────────────────────
  const submitCredentials = async (e) => {
    e.preventDefault();
    setError(""); setEmailError("");

    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) { setEmailError(emailCheck.error); return; }
    if (!password)      { setError("Password is required"); return; }
    if (inFlightRef.current || loading) return;

    inFlightRef.current = true;
    setLoading(true);

    try {
      const res  = await fetch("/api/auth/login-step1", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: emailCheck.value, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      setHasPhone(Boolean(data.hasPhone));
      setDigits(EMPTY_DIGITS());
      autoSubmitRef.current = false;
      setMode("code");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  // ── Step 2: 6-digit code ──────────────────────────────────────────────────
  const code = useMemo(() => digits.join(""), [digits]);

  const updateDigit = (index, value) => {
    const char = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    setError("");
    autoSubmitRef.current = false;
    if (char && index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    const next = EMPTY_DIGITS();
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    setError("");
    autoSubmitRef.current = false;
    inputsRef.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  };

  const submitCode = useCallback(async (e) => {
    e?.preventDefault?.();
    if (code.length !== CODE_LENGTH) { setError("Enter the 6-digit code."); return; }
    if (verifyFlightRef.current || loading) return;
    verifyFlightRef.current = true;
    setLoading(true);
    setError("");

    try {
      const res  = await fetch("/api/auth/login-step2", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.expired) {
          setMode("credentials");
          setDigits(EMPTY_DIGITS());
          setPassword("");
        }
        setError(data.error || "Verification failed");
        return;
      }

      if (data.session) {
        await applySessionUser(data.session);
      } else {
        // Session was set via cookie — trigger a client refresh
        const supabase = createClient();
        const { data: sd } = await supabase.auth.getSession();
        if (sd?.session) await applySessionUser(sd.session);
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      verifyFlightRef.current = false;
      setLoading(false);
    }
  }, [
    code, loading, applySessionUser, router, nextPath,
    setDigits, setError, setLoading, setMode, setPassword,
  ]);

  // Auto-submit when all digits filled
  useEffect(() => {
    if (mode !== "code" || code.length !== CODE_LENGTH || loading || verifyFlightRef.current || autoSubmitRef.current) return;
    autoSubmitRef.current = true;
    void submitCode();
  }, [code, mode, loading, submitCode]);

  if (checkingAuth) return <main style={{ minHeight: "100vh", background: "#050505" }} />;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main style={{ minHeight: "100vh", background: "#050505", color: "white", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
      {mode === "credentials" ? (
        <form
          onSubmit={submitCredentials}
          style={{ width: "100%", maxWidth: 420, background: "#0d0d0d", border: "1px solid #222", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>

          {giftPreview?.gift ? (
            <p style={{ margin: 0, fontSize: 13, color: "#c9b8ff", lineHeight: 1.6 }}>
              Sign in to claim your gift{giftPreview.gift.item_title ? `: ${giftPreview.gift.item_title}` : ""}.
            </p>
          ) : null}

          <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Sign in</h1>
          <p style={{ margin: "0 0 8px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
            Enter your email and password to continue.
          </p>

          <div>
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
              required
              style={{ ...inputStyle, borderColor: emailError ? "#ef4444" : "#2a2a2a" }}
            />
            {emailError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{emailError}</div> : null}
          </div>

          <div>
            <input
              placeholder="Password"
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); if (error) setError(""); }}
              required
              style={inputStyle}
            />
          </div>

          {error ? <div style={{ color: "#ff4d4d", fontSize: 13 }}>{error}</div> : null}

          <button
            type="submit"
            disabled={loading}
            style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "Verifying…" : "Continue"}
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <Link href="/forgot-password" style={{ color: "#555", fontSize: 13 }}>
              Forgot password?
            </Link>
            <Link href={createAccountHref} style={{ color: "#777", fontSize: 13 }}>
              Create account
            </Link>
          </div>
        </form>
      ) : (
        <form
          onSubmit={submitCode}
          style={{ width: "100%", maxWidth: 420, background: "#0d0d0d", border: "1px solid #222", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Check your {hasPhone ? "email & phone" : "email"}</h1>
          <p style={{ margin: 0, color: "#888", fontSize: 13, lineHeight: 1.6 }}>
            We sent a 6-digit code to {email}{hasPhone ? " and your phone" : ""}.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={el => { inputsRef.current[index] = el; }}
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => updateDigit(index, e.target.value)}
                onPaste={handlePaste}
                onKeyDown={e => {
                  if (e.key === "Backspace" && !digit && index > 0) inputsRef.current[index - 1]?.focus();
                }}
                aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                style={{
                  flex: "1 1 0", minWidth: 0, maxWidth: 52, aspectRatio: "1", height: "auto",
                  background: "#111", border: "1px solid #2a2a2a", borderRadius: 10,
                  color: "white", textAlign: "center", fontSize: 22, fontWeight: 700,
                  outline: "none", boxSizing: "border-box", padding: 0,
                }}
              />
            ))}
          </div>

          {error ? <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div> : null}

          <button
            type="submit"
            disabled={loading}
            style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "Verifying…" : "Verify"}
          </button>

          <button
            type="button"
            onClick={() => { setMode("credentials"); setDigits(EMPTY_DIGITS()); setError(""); autoSubmitRef.current = false; }}
            style={{ background: "none", border: "none", color: "#555", fontSize: 13, cursor: "pointer", textAlign: "center", padding: 0 }}
          >
            ← Back to sign in
          </button>
        </form>
      )}
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
