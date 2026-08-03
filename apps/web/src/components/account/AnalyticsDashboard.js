"use client";
import { useState, useEffect } from "react";

export default function AnalyticsDashboard({ isMobile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Could not load analytics."); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ padding: 32, textAlign: "center", color: "#555", fontSize: 13 }}>Loading analytics…</div>
  );
  if (error) return (
    <div style={{ padding: 24, color: "#ff8a8a", fontSize: 13 }}>{error}</div>
  );

  const { tracks = [], totals = { plays: 0, purchases: 0 } } = data || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[
          { label: "Total Plays", value: totals.plays.toLocaleString(), color: "#00ffff" },
          { label: "Total Purchases", value: totals.purchases.toLocaleString(), color: "#a259ff" },
          { label: "Tracks", value: tracks.length, color: "#ff6b35" },
        ].map((s) => (
          <div key={s.label} style={{ padding: "16px 12px", background: "#080808", border: `1px solid ${s.color}22`, borderRadius: 14, textAlign: "center" }}>
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 4, letterSpacing: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Track list */}
      <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #151515", display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, textTransform: "uppercase" }}>Track</div>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, textTransform: "uppercase", width: 56, textAlign: "right" }}>Plays</div>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, textTransform: "uppercase", width: 56, textAlign: "right" }}>Sales</div>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, textTransform: "uppercase", width: 48, textAlign: "right" }}>Done%</div>
        </div>

        {tracks.length === 0 && (
          <div style={{ padding: "28px 16px", color: "#444", fontSize: 13, textAlign: "center" }}>
            No stream data yet — plays will appear once fans start listening.
          </div>
        )}

        {tracks.map((t, i) => (
          <div
            key={t.slug}
            style={{
              padding: "12px 16px",
              borderBottom: i < tracks.length - 1 ? "1px solid #111" : "none",
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#ddd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.title || t.slug}
              </div>
              {t.completionRate !== null && (
                <div style={{ marginTop: 5, height: 2, background: "#1a1a1a", borderRadius: 2 }}>
                  <div style={{ height: 2, width: `${t.completionRate}%`, background: "linear-gradient(90deg,#00ffff,#a259ff)", borderRadius: 2 }} />
                </div>
              )}
            </div>
            <div style={{ width: 56, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 10 }}>▶</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: t.plays > 0 ? "#00ffff" : "#333" }}>{t.plays.toLocaleString()}</span>
            </div>
            <div style={{ width: 56, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 10 }}>🛒</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: t.purchases > 0 ? "#a259ff" : "#333" }}>{t.purchases.toLocaleString()}</span>
            </div>
            <div style={{ width: 48, textAlign: "right" }}>
              <span style={{ fontSize: 12, color: t.completionRate !== null ? "#888" : "#333", fontWeight: 700 }}>
                {t.completionRate !== null ? `${t.completionRate}%` : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
