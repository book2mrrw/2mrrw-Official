"use client";

import { useEffect } from "react";

const COOKIE_NAME = "ff_attr";
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const UTM_KEYS = ["source", "medium", "campaign", "term", "content"];

function hasCookie(name) {
  return document.cookie.split("; ").some((entry) => entry.startsWith(`${name}=`));
}

/**
 * First-touch marketing attribution, captured once per visitor and never
 * overwritten. A plain client-set cookie, not the signed guest_session
 * cookie (that one is a security-sensitive identity credential — this is
 * just marketing metadata, read once at signup by
 * src/lib/auth/attribution-cookie.js). No network call: this only ever
 * writes a cookie, so it can't fail a page load or block anything.
 */
export default function MarketingAttributionCapture() {
  useEffect(() => {
    try {
      if (hasCookie(COOKIE_NAME)) return;

      const params = new URLSearchParams(window.location.search);
      const utm = {};
      for (const key of UTM_KEYS) {
        const value = params.get(`utm_${key}`);
        if (value) utm[key] = value.slice(0, 120);
      }

      const referrer = document.referrer && !document.referrer.startsWith(window.location.origin)
        ? document.referrer.slice(0, 300)
        : null;

      if (!Object.keys(utm).length && !referrer) return; // nothing worth recording — stays "direct" at signup time

      const payload = {
        ...utm,
        referrer,
        landingPath: window.location.pathname.slice(0, 200),
        capturedAt: new Date().toISOString(),
      };

      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(payload))}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
    } catch {
      // Attribution is best-effort enrichment — never worth surfacing an error for.
    }
  }, []);

  return null;
}
