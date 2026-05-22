"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

function slugsFromPurchaseItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => item.slug).filter(Boolean);
}

function slugsFromPurchaseRecord(purchase) {
  if (!purchase) return [];
  let items = purchase.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  return slugsFromPurchaseItems(items);
}

function resolveExpectedSlugs(searchParams) {
  const single = searchParams.get("slug");
  const many = searchParams.get("slugs");
  if (many) {
    return many.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (single) return [single];
  return [];
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { currentUser, refreshLibrary, refreshAccountState } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const loadPurchases = async () => {
      const res = await fetch("/api/purchases", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not load purchases.");
      }
      return data.purchases || [];
    };

    const load = async () => {
      try {
        let expectedSlugs = resolveExpectedSlugs(searchParams);

        await Promise.all([refreshAccountState(), refreshLibrary()]);

        for (let attempt = 0; attempt <= 6; attempt += 1) {
          if (cancelled) return;

          const account = await refreshAccountState();
          await refreshLibrary();
          const owned = new Set(account?.ownedSlugs || []);

          if (!expectedSlugs.length) {
            const orderHistory = await loadPurchases();
            if (cancelled) return;
            if (sessionId) {
              const match = orderHistory.find(
                (p) => p.stripe_checkout_session_id === sessionId
              );
              expectedSlugs = slugsFromPurchaseRecord(match);
            }
          }

          const pending =
            expectedSlugs.length > 0 &&
            expectedSlugs.some((slug) => !owned.has(slug));

          if (!pending) break;
          if (attempt < 6) await sleep(2000);
        }

        const orderHistory = await loadPurchases();
        if (!cancelled) setPurchases(orderHistory);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Network error. Could not load purchases.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshLibrary, refreshAccountState, searchParams]);

  const userName = currentUser?.name?.split(" ")[0] || "";

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "white", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, marginBottom: 30, textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>2MRRW</div>
      <div style={{ width: 72, height: 72, borderRadius: "50%", border: "2px solid #00ffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "#00ffff", marginBottom: 24, boxShadow: "0 0 24px rgba(0,255,255,0.4)" }}>✓</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: 2 }}>Payment Successful</h1>
      <p style={{ color: "#aaa", fontSize: 15, marginBottom: 30 }}>
        {userName ? `Thanks ${userName}, your order is confirmed.` : "Your order is confirmed."}
      </p>
      <div style={{ width: "100%", maxWidth: 520, background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 16, padding: 24, marginBottom: 30 }}>
        <h2 style={{ fontSize: 14, letterSpacing: 3, color: "#555", marginBottom: 16, textTransform: "uppercase" }}>Your Purchases</h2>
        {loading && <p style={{ color: "#555", fontSize: 13 }}>Loading your order history…</p>}
        {error && <p style={{ color: "red", fontSize: 13 }}>{error}</p>}
        {!loading && !error && purchases.length === 0 && (
          <p style={{ color: "#555", fontSize: 13 }}>No purchases found yet — they may take a moment to appear.</p>
        )}
        {!loading && purchases.map((purchase, i) => {
          let items = [];
          try {
            items = typeof purchase.items === "string" ? JSON.parse(purchase.items) : purchase.items || [];
          } catch { /* ignore */ }
          return (
            <div key={purchase.id || i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < purchases.length - 1 ? "1px solid #1e1e1e" : "none" }}>
              <div style={{ fontSize: 11, color: "#444", marginBottom: 6 }}>
                {new Date(purchase.purchased_at || purchase.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
              </div>
              {items.map((item, j) => (
                <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  {item.cover && <img src={item.cover} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
                  <span style={{ fontSize: 13, flex: 1 }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: "#00ffff" }}>${Number(item.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <Link href="/?tab=mymusic" style={{ padding: "12px 32px", background: "#111", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, textDecoration: "none", fontWeight: "bold", fontSize: 13, letterSpacing: 2 }}>← OPEN LIBRARY</Link>
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
