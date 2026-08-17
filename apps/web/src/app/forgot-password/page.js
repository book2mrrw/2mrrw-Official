"use client";

import { useState } from "react";
import Link from "next/link";
import { validateEmail } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/client";

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

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const check = validateEmail(email);
    if (!check.ok) { setError(check.error); return; }
    if (loading) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const origin   = typeof window !== "undefined" ? window.location.origin : "https://www.2mrrw.com";
      await supabase.auth.resetPasswordForEmail(check.value, {
        redirectTo: `${origin}/reset-password`,
      });
      setSent(true);
    } catch (err) {
      setError(err?.message || "Something went wrong");
    } finally {
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
        <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Reset password</h1>

        {sent ? (
          <>
            <p style={{ margin: "0 0 8px", color: "#aaa", fontSize: 14, lineHeight: 1.7 }}>
              If an account exists for <strong style={{ color: "white" }}>{email}</strong>, a reset link is on its way. Check your inbox and spam folder.
            </p>
            <Link href="/login" style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", textAlign: "center", textDecoration: "none", fontSize: 14 }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 8px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); if (error) setError(""); }}
              required
              style={{ ...inputStyle, borderColor: error ? "#ef4444" : "#2a2a2a" }}
            />
            {error ? <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div> : null}
            <button
              type="submit"
              disabled={loading}
              style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Sending…" : "Send Reset Link"}
            </button>
            <Link href="/login" style={{ color: "#777", fontSize: 13, textAlign: "center", marginTop: 4 }}>
              Back to sign in
            </Link>
          </>
        )}
      </form>
    </main>
  );
}
