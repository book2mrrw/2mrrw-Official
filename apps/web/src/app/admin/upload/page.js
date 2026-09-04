"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminGate } from "@/hooks/useAdminGate";
import { UploadWizard } from "@/components/admin/UploadWizard";

export default function AdminUploadPage() {
  const router = useRouter();
  const gate = useAdminGate();
  const checked = gate === "ok";
  const [resumeReleaseId, setResumeReleaseId] = useState(null);
  const [contentKind, setContentKind] = useState("music");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setResumeReleaseId(params.get("draft"));
    setContentKind(params.get("kind") === "podcast" ? "podcast" : "music");
  }, []);

  if (!checked) {
    return (
      <div style={{ minHeight: "100vh", background: "#050505", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 28, height: 28, border: "2px solid rgba(0,255,255,0.2)", borderTopColor: "#00ffff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#050505", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <UploadWizard
        initialReleaseId={resumeReleaseId}
        contentKind={contentKind}
        onComplete={() => router.push(contentKind === "podcast" ? "/admin/podcast" : "/admin/releases")}
        onDismiss={() => router.push(contentKind === "podcast" ? "/admin/podcast" : "/admin")}
      />
    </div>
  );
}
