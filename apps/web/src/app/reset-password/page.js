"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

function ResetForm() {
  const router = useRouter();
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [done,      setDone]      = useState(false);
  const [readyToShow, setReadyToShow] = useState(false);

  useEffect(() => {
    // Supabase puts the session from the reset link into the URL hash — pick it up
    const supabase = createClient();
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReadyToShow(true);
    });
    // Also check if we already have a session (link already processed)
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) setReadyToShow(true);
    });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm)  { setError("Passwords do not match"); return; }
    if (loading) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) { setError(updateError.message || "Update failed"); return; }
      const resetResponse = await fetch("/api/auth/mfa-session", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!resetResponse.ok) {
        setError("Password changed, but security sessions could not be revoked. Contact support before signing in.");
        return;
      }
      await supabase.auth.signOut();
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (!readyToShow) {
    return (
      <main style={{ minHeight: "100vh", background: "#050505", color: "white", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 420, background: "#0d0d0d", border: "1px solid #222", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>
          <p style={{ color: "#888", fontSize: 14 }}>Loading your reset session…</p>
          <Link href="/forgot-password" style={{ color: "#555", fontSize: 13 }}>Request a new reset link</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#050505", color: "white", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
      <form
        onSubmit={submit}
        style={{ width: "100%", maxWidth: 420, background: "#0d0d0d", border: "1px solid #222", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>
        <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Set new password</h1>

        {done ? (
          <p style={{ color: "#22c55e", fontSize: 14, margin: 0 }}>Password updated. Redirecting to sign in…</p>
        ) : (
          <>
            <p style={{ margin: "0 0 8px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
              Choose a strong password for your account.
            </p>
            <input
              placeholder="New password (min 8 characters)"
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); if (error) setError(""); }}
              required
              style={inputStyle}
            />
            <input
              placeholder="Confirm new password"
              type="password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); if (error) setError(""); }}
              required
              style={inputStyle}
            />
            {error ? <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div> : null}
            <button
              type="submit"
              disabled={loading}
              style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Saving…" : "Set Password"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#050505" }} />}>
      <ResetForm />
    </Suspense>
  );
}
