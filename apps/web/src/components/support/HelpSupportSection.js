"use client";

import { useCallback, useState } from "react";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
const SUPPORT_EMAIL = "callme2mrrw@gmail.com";

export default function HelpSupportSection({ userId }) {
  const [copied, setCopied] = useState(false);

  const supportBody = [
    "2MRRW Support Request",
    "",
    `User ID: ${userId || "not signed in"}`,
    `App version: ${APP_VERSION}`,
    "",
    "Describe your issue:",
  ].join("\n");

  const mailtoHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("2MRRW Support")}&body=${encodeURIComponent(supportBody)}`;

  const copyFallback = useCallback(async () => {
    const text = `${supportBody}\n\nEmail: ${SUPPORT_EMAIL}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }, [supportBody]);

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 className="section-heading" style={{ marginBottom: 16 }}>
        Help &amp; Support
      </h2>
      <p style={{ fontSize: 14, color: "#888", lineHeight: 1.7, marginBottom: 20 }}>
        Need help with your account, purchases, collector card, or vault access? Reach out and include your user ID so we can assist quickly.
      </p>
      <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
          Your context
        </div>
        <div style={{ fontSize: 12, color: "#aaa", fontFamily: "monospace", lineHeight: 1.8 }}>
          <div>User ID: {userId || "—"}</div>
          <div>App version: {APP_VERSION}</div>
        </div>
      </div>
      <a
        href={mailtoHref}
        style={{
          display: "inline-block",
          padding: "13px 22px",
          background: "#00ffff",
          color: "#000",
          fontWeight: 900,
          borderRadius: 10,
          textDecoration: "none",
          fontSize: 13,
          letterSpacing: 1,
          marginBottom: 12,
        }}
      >
        Email Support
      </a>
      <button
        type="button"
        onClick={copyFallback}
        style={{
          display: "block",
          padding: "12px 18px",
          background: "transparent",
          color: copied ? "#00ffff" : "#888",
          border: "1px solid #333",
          borderRadius: 10,
          cursor: "pointer",
          fontSize: 12,
          letterSpacing: 1,
        }}
      >
        {copied ? "Copied to clipboard" : "Copy support details (clipboard fallback)"}
      </button>
      <p style={{ fontSize: 12, color: "#555", marginTop: 16 }}>
        {SUPPORT_EMAIL}
      </p>
    </div>
  );
}
