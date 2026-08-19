"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
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
  boxSizing: "border-box",
};

function validatePassword(pw) {
  if (!pw || pw.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  return { ok: true };
}

function validatePhone(ph) {
  const digits = String(ph || "").replace(/\D/g, "");
  if (digits.length < 10) return { ok: false, error: "Enter a valid phone number" };
  return { ok: true, value: ph.trim() };
}

function JoinForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { applySessionUser } = useAuth();
  const giftToken    = searchParams.get("gift") || "";

  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [phone,       setPhone]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [emailError,  setEmailError]  = useState("");
  const [passError,   setPassError]   = useState("");
  const [confError,   setConfError]   = useState("");
  const [phoneError,  setPhoneError]  = useState("");
  const [existsHint,  setExistsHint]  = useState(false);
  const [giftPreview, setGiftPreview] = useState(null);
  const inFlightRef  = useRef(false);

  useEffect(() => {
    if (!giftToken) return;
    fetch(`/api/gifts/preview/${giftToken}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (d?.gift) {
          setGiftPreview(d);
          // Pre-fill the email field with the recipient address from the gift record
          if (d.gift.recipient_email) setEmail(d.gift.recipient_email);
        }
      })
      .catch(() => {});
  }, [giftToken]);

  const nextPath = giftToken ? `/gift/${giftToken}` : "/?tab=mymusic";

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setEmailError(""); setPassError(""); setConfError(""); setPhoneError(""); setExistsHint(false);

    const emailCheck = validateEmail(email);
    const passCheck  = validatePassword(password);
    // Phone is required for standard signups (needed for SMS 2FA) but optional for gift
    // recipients — they prove email ownership via the gift link in their inbox.
    const phoneTrimmed = phone.trim();
    const phoneCheck = (giftToken && !phoneTrimmed) ? { ok: true, value: null } : validatePhone(phone);

    if (!emailCheck.ok) setEmailError(emailCheck.error);
    if (!passCheck.ok)  setPassError(passCheck.error);
    if (password && confirm && password !== confirm) setConfError("Passwords do not match");
    if (!phoneCheck.ok) setPhoneError(phoneCheck.error);
    if (!emailCheck.ok || !passCheck.ok || (password && confirm && password !== confirm) || !phoneCheck.ok) return;

    if (inFlightRef.current || loading) return;
    inFlightRef.current = true;
    setLoading(true);

    try {
      // Gift signup path — server creates account with email already confirmed so no
      // second confirmation email is sent. The gift link arriving in the inbox proves
      // ownership of the address.
      if (giftToken) {
        const res = await fetch("/api/gifts/claim-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            email:    emailCheck.value,
            password,
            name:     name.trim() || undefined,
            phone:    phoneCheck.value,
            giftToken,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.existsHint) {
            setExistsHint(true);
            setError(data.error || "An account with this email already exists. Sign in instead.");
          } else if (data.error === "email_mismatch") {
            setEmailError(data.message || "This gift was sent to a different email address.");
          } else {
            setError(data.error || "Sign up failed");
          }
          return;
        }
        await applySessionUser(data.session);
        router.push(nextPath);
        router.refresh();
        return;
      }

      // Standard signup — server creates account with email already confirmed,
      // signs in immediately, and returns the session. No confirmation email.
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: emailCheck.value,
          password,
          name:  name.trim() || undefined,
          phone: phoneCheck.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.existsHint) {
          setExistsHint(true);
          setError(data.error || "An account with this email already exists. Sign in instead.");
        } else {
          setError(data.error || "Sign up failed");
        }
        return;
      }
      await applySessionUser(data.session);
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      setError(err?.message || "Sign up failed");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#050505", color: "white", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
      <form
        onSubmit={submit}
        style={{ width: "100%", maxWidth: 420, background: "#0d0d0d", border: "1px solid #222", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>

        {giftPreview?.gift ? (
          <div style={{ padding: 14, borderRadius: 12, background: "rgba(162,89,255,0.08)", border: "1px solid rgba(162,89,255,0.25)", marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#c9b8ff", lineHeight: 1.6 }}>
              You have a gift waiting — create your account to claim it{giftPreview.gift.item_title ? `: ${giftPreview.gift.item_title}` : ""}.
            </p>
          </div>
        ) : null}

        <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Join 2MRRW</h1>
        <p style={{ margin: "0 0 8px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
          Create your account with email and password.
        </p>

        <input
          placeholder="Full Name (optional)"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          style={inputStyle}
        />

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
            placeholder="Password (min 8 characters)"
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); if (passError) setPassError(""); }}
            required
            style={{ ...inputStyle, borderColor: passError ? "#ef4444" : "#2a2a2a" }}
          />
          {passError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{passError}</div> : null}
        </div>

        <div>
          <input
            placeholder="Confirm password"
            type="password"
            value={confirm}
            onChange={e => { setConfirm(e.target.value); if (confError) setConfError(""); }}
            required
            style={{ ...inputStyle, borderColor: confError ? "#ef4444" : "#2a2a2a" }}
          />
          {confError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{confError}</div> : null}
        </div>

        <div>
          <input
            placeholder={giftToken ? "Phone number (optional)" : "Phone number"}
            type="tel"
            value={phone}
            onChange={e => { setPhone(e.target.value); if (phoneError) setPhoneError(""); }}
            required={!giftToken}
            style={{ ...inputStyle, borderColor: phoneError ? "#ef4444" : "#2a2a2a" }}
          />
          {phoneError
            ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{phoneError}</div>
            : <div style={{ color: "#555", fontSize: 11, marginTop: 6 }}>{giftToken ? "Optional — add later in your account settings." : "Used to receive your login codes via SMS."}</div>
          }
        </div>

        {error ? <div style={{ color: "#ff4d4d", fontSize: 13 }}>{error}</div> : null}
        {existsHint ? (
          <Link href={giftToken ? `/login?gift=${giftToken}` : "/login"} style={{ color: "#00ffff", fontSize: 13 }}>
            Sign in instead →
          </Link>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "Creating account…" : "Create Account"}
        </button>

        <Link href={giftToken ? `/login?gift=${giftToken}` : "/login"} style={{ color: "#777", fontSize: 13, textAlign: "center", marginTop: 4 }}>
          Already have an account? Sign in
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
