"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

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

export default function CollectorActivatePage() {
  const router = useRouter();
  const { user, loading, refreshAccountState } = useAuth();
  const [visibleSerial, setVisibleSerial] = useState("");
  const [legalName, setLegalName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/join?next=/collector/activate");
    }
  }, [loading, user, router]);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      setSuccess(null);
      setSubmitting(true);
      try {
        const res = await fetch("/api/collector-card/activate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibleSerial, legalName }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Activation failed.");
          return;
        }
        setSuccess(data);
        await refreshAccountState?.({
          reason: "collector:updated",
          source: "collector/activate",
          force: true,
        });
      } catch (err) {
        setError(err.message || "Activation failed.");
      } finally {
        setSubmitting(false);
      }
    },
    [visibleSerial, legalName, refreshAccountState]
  );

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: "#000", color: "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading…
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 50% 0%, rgba(0,255,255,0.06) 0%, #000 55%)",
        color: "#fff",
        padding: "48px 20px 80px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#00ffff", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>
          Collector Card
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.2 }}>Activate your card</h1>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 28, lineHeight: 1.5 }}>
          Enter the serial on your physical card and your full legal name. NFC tap verification stays separate.
        </p>

        {success ? (
          <div
            style={{
              padding: "20px 18px",
              borderRadius: 14,
              border: "1px solid rgba(0,255,255,0.35)",
              background: "rgba(0,255,255,0.06)",
              marginBottom: 24,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Card activated</div>
            <div style={{ fontSize: 12, color: "#aaa" }}>
              {success.card?.releaseName || "Collector"} · {success.card?.visibleSerial}
            </div>
            <Link
              href="/?tab=mymusic"
              style={{
                display: "inline-block",
                marginTop: 16,
                padding: "10px 18px",
                background: "#00ffff",
                color: "#000",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Open My Music
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: "#888", letterSpacing: 1 }}>
              CARD SERIAL
              <input
                style={inputStyle}
                value={visibleSerial}
                onChange={(e) => setVisibleSerial(e.target.value)}
                placeholder="e.g. T.B.H // 42/100"
                autoComplete="off"
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: "#888", letterSpacing: 1 }}>
              FULL LEGAL NAME
              <input
                style={inputStyle}
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="As shown on government ID"
                autoComplete="name"
                required
              />
            </label>
            {error ? (
              <div style={{ fontSize: 12, color: "#ff6b6b", lineHeight: 1.4 }}>{error}</div>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "14px",
                background: submitting ? "#333" : "#00ffff",
                color: submitting ? "#888" : "#000",
                border: "none",
                borderRadius: 10,
                fontWeight: 800,
                fontSize: 14,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              {submitting ? "Activating…" : "Activate collector card"}
            </button>
          </form>
        )}

        <p style={{ marginTop: 28, fontSize: 11, color: "#444" }}>
          <Link href="/" style={{ color: "#666" }}>
            ← Back to 2MRRW
          </Link>
        </p>
      </div>
    </main>
  );
}
