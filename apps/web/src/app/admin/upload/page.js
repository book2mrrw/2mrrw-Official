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

  useEffect(() => {
    setResumeReleaseId(new URLSearchParams(window.location.search).get("draft"));
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
        onComplete={() => router.push("/admin/releases")}
        onDismiss={() => router.push("/admin")}
      />
    </div>
  );
}
