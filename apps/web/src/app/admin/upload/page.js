"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { UploadWizard } from "@/components/admin/UploadWizard";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();
function isAdmin(session) {
  return (session?.user?.email?.toLowerCase() || "") === ADMIN_EMAIL;
}

export default function AdminUploadPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [resumeReleaseId, setResumeReleaseId] = useState(null);

  useEffect(() => {
    setResumeReleaseId(new URLSearchParams(window.location.search).get("draft"));
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
    );
    sb.auth.getSession().then(({ data }) => {
      if (!isAdmin(data.session)) { router.replace("/"); return; }
      setChecked(true);
    });
  }, [router]);

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
