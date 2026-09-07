"use client";

import { useState } from "react";

const C = {
  surface: "#0d0d0d",
  border: "rgba(255,255,255,0.06)",
  accent: "#00ffff",
  surface2: "#111",
  text: "#e8e8e8",
  muted: "rgba(255,255,255,0.45)",
};

/**
 * Triggers POST /api/admin/printful/sync (idempotent — upserts by Printful's
 * own external_product_id, never duplicates). Shared between the standalone
 * /admin Control Center and the home page's Shop tab, so an admin can sync
 * from wherever they actually look at the merch, not just a separate page.
 */
export default function SyncPrintfulButton() {
  const [status, setStatus] = useState("idle"); // idle | syncing | done | error
  const [summary, setSummary] = useState(null);

  const handleSync = async () => {
    setStatus("syncing");
    setSummary(null);
    try {
      const res = await fetch("/api/admin/printful/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSummary(data);
      setStatus("done");
    } catch (err) {
      setSummary({ error: err.message });
      setStatus("error");
    }
  };

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "20px 22px",
      marginBottom: 24,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 20,
      flexWrap: "wrap",
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 5 }}>🧵 Sync Printful Catalog</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Pulls your real designs, titles, photos, and every size/color variant straight from Printful into the merch shop.
        </div>
        {status === "done" && summary && !summary.error && (
          <div style={{ fontSize: 12, color: "#32d74b", marginTop: 8 }}>
            ✓ Synced {summary.products} product{summary.products === 1 ? "" : "s"}, {summary.variants} variant{summary.variants === 1 ? "" : "s"}
            {summary.errors?.length > 0 ? ` — ${summary.errors.length} item(s) failed, check server logs` : ""}
          </div>
        )}
        {status === "error" && (
          <div style={{ fontSize: 12, color: "#ff453a", marginTop: 8 }}>✗ {summary?.error}</div>
        )}
      </div>
      <button
        onClick={handleSync}
        disabled={status === "syncing"}
        style={{
          background: status === "syncing" ? C.surface2 : C.accent,
          color: status === "syncing" ? C.muted : "#000",
          border: "none",
          borderRadius: 10,
          padding: "12px 24px",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: status === "syncing" ? "wait" : "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {status === "syncing" ? "Syncing…" : "Sync Now"}
      </button>
    </div>
  );
}
