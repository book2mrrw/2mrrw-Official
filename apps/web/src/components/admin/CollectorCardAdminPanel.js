"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAccount } from "@/lib/music-access";

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  background: "#080808",
  border: "1px solid #222",
  borderRadius: 8,
  color: "#eee",
  fontSize: 13,
  marginBottom: 8,
};

const btnStyle = {
  padding: "10px 14px",
  background: "#00ffff",
  color: "#000",
  border: "none",
  borderRadius: 8,
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
  letterSpacing: 1,
};

async function adminPost(action, payload) {
  const res = await fetch("/api/admin/collector-cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function CollectorCardAdminPanel({ accountState }) {
  const [userId, setUserId] = useState("");
  const [importJson, setImportJson] = useState("");
  const [checkins, setCheckins] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const loadCheckins = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/collector-cards?limit=30");
      const data = await res.json();
      if (res.ok) setCheckins(data.checkins || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (isAdminAccount(accountState)) loadCheckins();
  }, [accountState, loadCheckins]);

  if (!isAdminAccount(accountState)) return null;

  const run = async (label, fn) => {
    setLoading(true);
    setStatus("");
    try {
      await fn();
      setStatus(`${label}: OK`);
      if (label.includes("Import")) await loadCheckins();
    } catch (err) {
      setStatus(`${label}: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: 20, marginTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: 3, color: "#a259ff", marginBottom: 12, textTransform: "uppercase" }}>
        Collector Card Admin
      </div>

      <label style={{ fontSize: 11, color: "#666", letterSpacing: 1 }}>Target user ID</label>
      <input
        value={userId}
        onChange={(e) => setUserId(e.target.value.trim())}
        placeholder="UUID"
        style={inputStyle}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button type="button" disabled={loading || !userId} style={btnStyle} onClick={() => run("Grant vault", () => adminPost("gift_vault", { userId }))}>
          Gift Vault
        </button>
        <button type="button" disabled={loading || !userId} style={btnStyle} onClick={() => run("Grant subscriber", () => adminPost("grant_subscriber", { userId }))}>
          Grant Subscriber
        </button>
        <button type="button" disabled={loading || !userId} style={btnStyle} onClick={() => run("Grant collector", () => adminPost("grant_collector", { userId }))}>
          Grant Collector Card
        </button>
        <button type="button" disabled={loading || !userId} style={{ ...btnStyle, background: "#ff4d4d", color: "#fff" }} onClick={() => run("Revoke all", () => adminPost("revoke", { userId }))}>
          Revoke All
        </button>
      </div>

      <label style={{ fontSize: 11, color: "#666", letterSpacing: 1 }}>Import serials JSON</label>
      <textarea
        value={importJson}
        onChange={(e) => setImportJson(e.target.value)}
        placeholder='[{"visibleSerial":"001/500","secret":"...","releaseTitle":"Love Hz","productSlug":"exc-card-lovehz"}]'
        rows={4}
        style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }}
      />
      <button
        type="button"
        disabled={loading || !importJson.trim()}
        style={{ ...btnStyle, marginBottom: 16 }}
        onClick={() =>
          run("Import", async () => {
            const cards = JSON.parse(importJson);
            return adminPost("import_serials", { cards });
          })
        }
      >
        Import Serials
      </button>

      <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
        Event check-ins
      </div>
      <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 11, color: "#888" }}>
        {checkins.length === 0 ? (
          <div>No check-ins yet.</div>
        ) : (
          checkins.map((row) => (
            <div key={row.id} style={{ padding: "6px 0", borderBottom: "1px solid #111" }}>
              {row.checked_in_at?.slice(0, 19)} · {row.event_name} · {row.checkin_method} · {row.status}
            </div>
          ))
        )}
      </div>

      {status ? <div style={{ marginTop: 10, fontSize: 12, color: status.includes("OK") ? "#00ffff" : "#ff6b35" }}>{status}</div> : null}
    </div>
  );
}
