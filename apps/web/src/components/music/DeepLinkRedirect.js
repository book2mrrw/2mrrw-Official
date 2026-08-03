"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { setPendingDeepLink } from "@/lib/deep-links";

export default function DeepLinkRedirect({ type }) {
  const { slug } = useParams();
  const router = useRouter();

  useEffect(() => {
    if (!slug) {
      router.replace("/");
      return;
    }
    const value = `${type}:${decodeURIComponent(slug)}`;
    setPendingDeepLink(value);
    router.replace(`/?${new URLSearchParams({ deepLink: value }).toString()}`);
  }, [slug, type, router]);

  return (
    <div style={{ minHeight: "40vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
      Opening…
    </div>
  );
}
