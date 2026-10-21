"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { subscribeCatalogRefresh, getCatalogRefreshRevision, getCatalogRefreshServerRevision } from "@/lib/storefront/catalog-refresh-store";
export function useReleaseCredits(slug, open = true) {
  const revision = useSyncExternalStore(subscribeCatalogRefresh, getCatalogRefreshRevision, getCatalogRefreshServerRevision);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const requestKey = JSON.stringify([slug, open, attempt, revision]);
  const retry = useCallback(() => setAttempt(a => a + 1), []);
  useEffect(() => {
    if (!slug || !open) return;
    const controller = new AbortController();
    let active = true;
    fetch(`/api/catalog/releases/${encodeURIComponent(slug)}`, { cache: "no-store", signal: controller.signal })
      .then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error); if (body.release?.slug !== slug) throw new Error("Release identity mismatch"); return body.release; })
      .then(release => { if (active) setResult({ key: requestKey, status: "ready", release }); })
      .catch(error => { if (active && error.name !== "AbortError") setResult({ key: requestKey, status: "error" }); });
    return () => { active = false; controller.abort(); };
  }, [slug, open, requestKey]);
  return { ...(result?.key === requestKey ? result : { status: "loading" }), retry };
}
