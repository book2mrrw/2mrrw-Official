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

function buildCatalogLabel(state, details) {
  if (state === "idle") return "Sync Catalog";
  if (state === "loading") return "Syncing…";
  if (state === "ok") {
    const n = details?.summary?.productsUpserted;
    return n != null ? `Synced ${n} ✓` : "Synced ✓";
  }
  // error
  const upserted = details?.summary?.productsUpserted;
  const failed = details?.summary?.failed;
  if (upserted > 0 && failed > 0) return `Partial (${failed} failed)`;
  return "Failed ✗";
}

function buildAudioLabel(state, details) {
  if (state === "idle") return "Sync Audio";
  if (state === "loading") return "Queuing…";
  if (state === "ok") {
    const n = details?.queued;
    return n != null ? `Queued ${n} ✓` : "Queued ✓";
  }
  return "Failed ✗";
}

function buildTooltip(state, details) {
  if (state !== "error" || !details) return undefined;
  if (details.error) return details.error;
  if (details.failed?.length) {
    return details.failed.slice(0, 5).map((f) => `${f.slug || f.type || "?"}: ${f.error}`).join("\n");
  }
  return undefined;
}

function AdminIngestButton() {
  const { isAdmin } = useAuth();
  const [catalogState, setCatalogState] = useState("idle");
  const [audioState, setAudioState] = useState("idle");
  const [catalogDetails, setCatalogDetails] = useState(null);
  const [audioDetails, setAudioDetails] = useState(null);

  if (!isAdmin) return null;

  async function triggerCatalog() {
    if (catalogState === "loading") return;
    setCatalogState("loading");
    setCatalogDetails(null);
    try {
      const res = await fetch("/api/admin/catalog/ingest-trigger", { method: "POST" });
      const json = await res.json();
      setCatalogDetails(json);
      setCatalogState(json.ok ? "ok" : "error");
    } catch (e) {
      setCatalogDetails({ error: e?.message || "Network error" });
      setCatalogState("error");
    }
    setTimeout(() => { setCatalogState("idle"); setCatalogDetails(null); }, 8000);
  }

  async function triggerAudio() {
    if (audioState === "loading") return;
    setAudioState("loading");
    setAudioDetails(null);
    try {
      const res = await fetch("/api/admin/catalog/hls-sync-trigger", { method: "POST" });
      const json = await res.json();
      setAudioDetails(json);
      setAudioState(json.ok ? "ok" : "error");
    } catch (e) {
      setAudioDetails({ error: e?.message || "Network error" });
      setAudioState("error");
    }
    setTimeout(() => { setAudioState("idle"); setAudioDetails(null); }, 8000);
  }

  const stateStyle = (s) => ({
    color: s === "ok" ? "#4ade80" : s === "error" ? "#f87171" : "#aaa",
    background: s === "ok" ? "#0d3320" : s === "error" ? "#3a0d0d" : "#1a1a1a",
    borderColor: s === "ok" ? "#1a6e40" : s === "error" ? "#6e1a1a" : s === "loading" ? "#555" : "#333",
    cursor: s === "loading" ? "default" : "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
      <button
        onClick={triggerCatalog}
        disabled={catalogState === "loading"}
        title={buildTooltip(catalogState, catalogDetails)}
        style={{ ...BTN_BASE, ...stateStyle(catalogState) }}
      >
        {buildCatalogLabel(catalogState, catalogDetails)}
      </button>
      <button
        onClick={triggerAudio}
        disabled={audioState === "loading"}
        title={buildTooltip(audioState, audioDetails)}
        style={{ ...BTN_BASE, ...stateStyle(audioState) }}
      >
        {buildAudioLabel(audioState, audioDetails)}
      </button>
    </div>
  );
}

export default memo(AdminIngestButton);
