"use client";

import { memo, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const BTN_BASE = {
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  borderRadius: 6,
  fontFamily: "inherit",
  transition: "all 0.2s",
  whiteSpace: "nowrap",
  border: "1px solid",
  cursor: "pointer",
};

function AdminIngestButton() {
  const { isAdmin } = useAuth();
  const [catalogState, setCatalogState] = useState("idle"); // idle | loading | ok | error
  const [audioState, setAudioState] = useState("idle");

  if (!isAdmin) return null;

  async function triggerCatalog() {
    if (catalogState === "loading") return;
    setCatalogState("loading");
    try {
      const res = await fetch("/api/admin/catalog/ingest-trigger", { method: "POST" });
      const json = await res.json();
      setCatalogState(json.ok ? "ok" : "error");
    } catch {
      setCatalogState("error");
    }
    setTimeout(() => setCatalogState("idle"), 4000);
  }

  async function triggerAudio() {
    if (audioState === "loading") return;
    setAudioState("loading");
    try {
      const res = await fetch("/api/admin/catalog/hls-sync-trigger", { method: "POST" });
      const json = await res.json();
      setAudioState(json.ok ? "ok" : "error");
    } catch {
      setAudioState("error");
    }
    setTimeout(() => setAudioState("idle"), 4000);
  }

  const catalogLabel = { idle: "Sync Catalog", loading: "Syncing…", ok: "Synced ✓", error: "Failed ✗" }[catalogState];
  const audioLabel   = { idle: "Sync Audio",   loading: "Queuing…", ok: "Queued ✓", error: "Failed ✗" }[audioState];

  const stateStyle = (s) => ({
    color: s === "ok" ? "#4ade80" : s === "error" ? "#f87171" : "#aaa",
    background: s === "ok" ? "#0d3320" : s === "error" ? "#3a0d0d" : "#1a1a1a",
    borderColor: s === "ok" ? "#1a6e40" : s === "error" ? "#6e1a1a" : s === "loading" ? "#555" : "#333",
    cursor: s === "loading" ? "default" : "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
      <button onClick={triggerCatalog} disabled={catalogState === "loading"} style={{ ...BTN_BASE, ...stateStyle(catalogState) }}>
        {catalogLabel}
      </button>
      <button onClick={triggerAudio} disabled={audioState === "loading"} style={{ ...BTN_BASE, ...stateStyle(audioState) }}>
        {audioLabel}
      </button>
    </div>
  );
}

export default memo(AdminIngestButton);
