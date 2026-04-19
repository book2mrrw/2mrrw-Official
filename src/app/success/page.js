"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function SuccessContent() {
  const searchParams = useSearchParams();
  const userId = searchParams.get("user_id");
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("2mrrw_user");
    if (stored) setUserName(JSON.parse(stored).name?.split(" ")[0] || "");
    if (!userId) { setError("No user ID found."); setLoading(false); return; }
    fetch(`/api/purchases?user_id=${userId}`)
      .then((res) => res.json())
      .then((data) => { setPurchases(data.purchases || []); })
      .catch(() => setError("Network error. Could not load purchases."))
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "white", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, marginBottom: 30, textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>2MRRW</div>
      <div style={{ width: 72, height: 72, borderRadius: "50%", border: "2px solid #00ffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "#00ffff", marginBottom: 24, boxShadow: "0 0 24px rgba(0,255,255,0.4)" }}>✓</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: 2 }}>Payment Successful</h1>
      <p style={{ color: "#aaa", fontSize: 15, marginBottom: 30 }}>{userName ? `Thanks ${userName}, your order is confirmed.` : "Your order is confirmed."}</p>
      <div style={{ width: "100%", maxWidth: 520, background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 16, padding: 24, marginBottom: 30 }}>
        <h2 style={{ fontSize: 14, letterSpacing: 3, color: "#555", marginBottom: 16, textTransform: "uppercase" }}>Your Purchases</h2>
        {loading && <p style={{ color: "#555", fontSize: 13 }}>Loading your order history…</p>}
        {error && <p style={{ color: "red", fontSize: 13 }}>{error}</p>}
        {!loading && !error && purchases.length === 0 && <p style={{ color: "#555", fontSize: 13 }}>No purchases found yet — they may take a moment to appear.</p>}
        {!loading && purchases.map((purchase, i) => {
          let items = [];
          try { items = typeof purchase.items === "string" ? JSON.parse(purchase.items) : purchase.items || []; } catch {}
          return (
            <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < purchases.length - 1 ? "1px solid #1e1e1e" : "none" }}>
              <div style={{ fontSize: 11, color: "#444", marginBottom: 6 }}>
                {new Date(purchase.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
              </div>
              {items.map((item, j) => (
                <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  {item.cover && <img src={item.cover} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
                  <span style={{ fontSize: 13, flex: 1 }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: "#00ffff" }}>${Number(item.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <Link href="/" style={{ padding: "12px 32px", background: "#111", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, textDecoration: "none", fontWeight: "bold", fontSize: 13, letterSpacing: 2 }}>← BACK TO STORE</Link>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div style={{ background: "#050505", color: "white", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading…</div>}>
      <SuccessContent />
    </Suspense>
  );
}