"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { AdminVerificationOverlay } from "@/components/admin/AdminVerificationOverlay";
import { RECOVERABLE_ADMIN_AUTH_CODES } from "@/lib/auth/admin-authority-diagnostics";
import { releaseDeletionConfirmation } from "@/lib/releases/deletion-projection";
import { commitDeletedReleaseSlugs } from "@/lib/releases/deletion-store";
import { signalCatalogMutation } from "@/lib/storefront/catalog-refresh-store";

export default function DeleteReleaseButton({ release, onDeleted }) {
  const { currentUser } = useAuth();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verify, setVerify] = useState(false);

  async function remove(confirmed = false) {
    if (busyRef.current || (!confirmed && !window.confirm(releaseDeletionConfirmation(release)))) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/releases/${release.id}?source=${release.source === "catalog" ? "catalog" : "releases"}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (RECOVERABLE_ADMIN_AUTH_CODES.has(data.code)) { setVerify(true); return; }
        throw new Error(data.error || "Release deletion failed");
      }
      commitDeletedReleaseSlugs(data.deleted_slugs || [data.slug || release.slug]);
      signalCatalogMutation("release_deleted");
      onDeleted(release);
    } catch (failure) {
      setError(failure.message || "Deletion could not be confirmed. Refresh before retrying.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <button type="button" disabled={busy} onClick={() => remove()}
      aria-label={`Delete ${release.title || release.slug}`}
      style={{ border: "1px solid rgba(255,69,58,.4)", borderRadius: 7, background: "rgba(255,69,58,.1)",
        color: "#ff453a", padding: "9px 14px", minHeight: 44, font: "inherit", fontSize: 12, cursor: "pointer" }}>
      {busy ? "Deleting…" : release.status === "draft" ? "Delete Draft" : "Delete Release"}
    </button>
    {error && <span role="alert" style={{ display: "block", color: "#ff453a", maxWidth: 260, fontSize: 12 }}>{error}</span>}
    {verify && <AdminVerificationOverlay email={currentUser?.email || ""}
      onCancel={() => setVerify(false)} onVerified={() => { setVerify(false); remove(true); }} />}
  </span>;
}
