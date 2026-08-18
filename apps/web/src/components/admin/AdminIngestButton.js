"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function AdminIngestButton() {
  const { isAdmin } = useAuth();
  const [state, setState] = useState("idle"); // idle | loading | ok | error

  if (!isAdmin) return null;

  async function trigger() {
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/admin/catalog/ingest-trigger", { method: "POST" });
      const json = await res.json();
      setState(json.ok ? "ok" : "error");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  const label = { idle: "Sync Catalog", loading: "Syncing…", ok: "Synced ✓", error: "Failed ✗" }[state];
  const bg = { idle: "#1a1a1a", loading: "#1a1a1a", ok: "#0d3320", error: "#3a0d0d" }[state];
  const border = { idle: "#333", loading: "#555", ok: "#1a6e40", error: "#6e1a1a" }[state];

  return (
    <button
      onClick={trigger}
      disabled={state === "loading"}
      style={{
        position: "fixed",
        top: 14,
        right: 16,
        zIndex: 9999,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color: state === "ok" ? "#4ade80" : state === "error" ? "#f87171" : "#aaa",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        cursor: state === "loading" ? "default" : "pointer",
        fontFamily: "inherit",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
