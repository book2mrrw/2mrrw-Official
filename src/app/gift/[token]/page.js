"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function GiftRedeemPage() {
  const { token } = useParams();
  const router = useRouter();
  const { refreshGuest, refreshLibrary } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const redeem = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/gifts/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, name, email, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not redeem gift");
      await refreshGuest();
      await refreshLibrary();
      setSuccess(`Unlocked: ${(data.slugs || []).join(", ")}`);
      setTimeout(() => router.push("/?tab=mymusic"), 900);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#050505", color: "white", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
      <form onSubmit={redeem} style={{ width: "100%", maxWidth: 420, background: "#0d0d0d", border: "1px solid #222", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>
        <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Redeem Gift</h1>
        <p style={{ margin: "0 0 12px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
          Enter your email and phone so this gift is saved to your personal library forever.
        </p>
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        <input placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
        <input placeholder="Phone Number" value={phone} onChange={(e) => setPhone(e.target.value)} required style={inputStyle} />
        {error && <div style={{ color: "#ff4d4d", fontSize: 13 }}>{error}</div>}
        {success && <div style={{ color: "#00ffff", fontSize: 13 }}>{success}</div>}
        <button disabled={loading} style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", opacity: loading ? 0.7 : 1 }}>
          {loading ? "Unlocking..." : "Unlock Gift"}
        </button>
        <Link href="/" style={{ color: "#777", fontSize: 13, textAlign: "center", marginTop: 4 }}>Back to site</Link>
      </form>
    </main>
  );
}

const inputStyle = {
  padding: "12px 14px",
  background: "#111",
  border: "1px solid #2a2a2a",
  color: "white",
  borderRadius: 10,
  fontSize: 14,
  outline: "none",
};
