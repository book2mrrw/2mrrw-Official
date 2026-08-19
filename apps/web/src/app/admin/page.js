"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();

function isAdmin(session) {
  return (session?.user?.email?.toLowerCase() || "") === ADMIN_EMAIL;
}

const C = {
  bg: "#050505",
  surface: "#0d0d0d",
  surface2: "#111",
  border: "rgba(255,255,255,0.06)",
  border2: "rgba(255,255,255,0.10)",
  accent: "#00ffff",
  accentDim: "rgba(0,255,255,0.07)",
  accentBorder: "rgba(0,255,255,0.18)",
  purple: "#a259ff",
  text: "#e8e8e8",
  muted: "rgba(255,255,255,0.45)",
  muted2: "rgba(255,255,255,0.28)",
};

const NAV_ITEMS = [
  { label: "Audio Refresh", href: "/admin/media", icon: "🎵", desc: "Re-ingest R2 audio, clear HLS caches, re-queue transcoding" },
  { label: "Visual Layer", href: "/admin/visual-layer", icon: "🎨", desc: "Manage release visual assets, animated covers, artwork" },
  { label: "Gifts", href: "/admin/gifts", icon: "🎁", desc: "Create and manage gift links for fans" },
  { label: "Shows", href: "/admin/shows", icon: "🎤", desc: "Manage live event listings and ticket links" },
  { label: "Analytics", href: "/admin/analytics", icon: "🌍", desc: "Global fan map, stream counts, geographic breakdown" },
];

export default function AdminPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    sb.auth.getSession().then(({ data }) => {
      if (!isAdmin(data.session)) { router.replace("/"); return; }
      setChecked(true);
    });
  }, [router]);

  if (!checked) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 28, height: 28, border: `2px solid ${C.accentBorder}`, borderTopColor: C.accent, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "48px 24px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: C.accent, textTransform: "uppercase", marginBottom: 10 }}>
            2MRRW ADMIN
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1.1 }}>
            Control Center
          </h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 8, margin: "8px 0 0" }}>
            Manage releases, audio, visuals, gifts, and fan analytics.
          </p>
        </div>

        {/* Upload Release CTA */}
        <div style={{
          background: `linear-gradient(135deg, rgba(0,255,255,0.08) 0%, rgba(162,89,255,0.06) 100%)`,
          border: `1px solid ${C.accentBorder}`,
          borderRadius: 16,
          padding: "32px 36px",
          marginBottom: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.accent, textTransform: "uppercase", marginBottom: 8 }}>
              NEW RELEASE
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>
              Upload a Release
            </div>
            <div style={{ fontSize: 13, color: C.muted, maxWidth: 480 }}>
              Single, Feature, Album, EP, or Mixtape — upload master audio, artwork, lyrics, and credits. Goes live instantly on the storefront.
            </div>
          </div>
          <button
            onClick={() => router.push("/admin/upload")}
            style={{
              background: C.accent,
              color: "#000",
              border: "none",
              borderRadius: 10,
              padding: "14px 28px",
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            + Upload Release
          </button>
        </div>

        {/* Admin tools grid */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.muted2, textTransform: "uppercase", marginBottom: 16 }}>
          Tools
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 48 }}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={{
                display: "block",
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: "20px 22px",
                textDecoration: "none",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = C.accentBorder;
                e.currentTarget.style.background = C.accentDim;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.background = C.surface;
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 10 }}>{item.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 5 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{item.desc}</div>
            </a>
          ))}
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <a href="/" style={{ fontSize: 12, color: C.muted2, textDecoration: "none" }}>← Back to Site</a>
          <a href="/account" style={{ fontSize: 12, color: C.muted2, textDecoration: "none" }}>Account</a>
        </div>
      </div>
    </div>
  );
}
