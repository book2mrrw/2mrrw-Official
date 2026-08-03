"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import CoverArt from "@/components/ui/CoverArt";
import { catalogCoverUrl } from "@/lib/media-urls";
import { notifyEntitlementsUpdated } from "@/lib/diagnostics/state-churn-log";

const SUCCESS_POLL_DELAYS_MS = [1000, 2000, 4000];
const SUCCESS_POLL_MAX_ATTEMPTS = 3;

function slugsFromPurchaseItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => item.slug).filter(Boolean);
}

function slugsFromPurchaseRecord(purchase) {
  if (!purchase) return [];
  let items = purchase.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  return slugsFromPurchaseItems(items);
}

function parsePurchaseItems(purchase) {
  if (!purchase) return [];
  let items = purchase.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  return Array.isArray(items) ? items : [];
}

function resolveExpectedSlugs(searchParams) {
  const single = searchParams.get("slug");
  const many = searchParams.get("slugs");
  if (many) {
    return many.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (single) return [single];
  return [];
}

function pickCollectedItem(purchases, sessionId, expectedSlugs) {
  let items = [];
  if (sessionId) {
    const match = purchases.find((p) => p.stripe_checkout_session_id === sessionId);
    items = parsePurchaseItems(match);
  }
  if (!items.length && purchases.length) {
    items = parsePurchaseItems(purchases[0]);
  }
  const preferred =
    items.find((item) => item?.slug && expectedSlugs.includes(item.slug)) ||
    items.find((item) => {
      const type = String(item?.type || item?.product_type || "").toLowerCase();
      return type && !["merch", "vinyl", "ticket"].includes(type);
    }) ||
    items[0];

  if (!preferred) return null;

  const coverRaw = preferred.cover || preferred.cover_url || preferred.coverArt;
  return {
    title: preferred.title || "Collected",
    subtitle: preferred.artist || preferred.subtitle || "Now in your collection",
    cover: coverRaw ? catalogCoverUrl(coverRaw) : null,
    coverArtType: preferred.coverArtType || preferred.cover_art_type || "image",
  };
}

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { refreshLibrary, refreshAccountState, invalidateEntitlementSnapshot } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collected, setCollected] = useState(null);
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [buttonPressed, setButtonPressed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const loadPurchases = async () => {
      const res = await fetch("/api/purchases", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not load purchases.");
      }
      return data.purchases || [];
    };

    const load = async () => {
      try {
        let expectedSlugs = resolveExpectedSlugs(searchParams);

        let prevOwnedKey = "";

        for (let attempt = 0; attempt < SUCCESS_POLL_MAX_ATTEMPTS; attempt += 1) {
          if (cancelled) return;
          if (attempt > 0) await sleep(SUCCESS_POLL_DELAYS_MS[attempt - 1]);

          if (attempt === 0) {
            invalidateEntitlementSnapshot("purchase:completed");
          }
          const account = await refreshAccountState({
            source: "success/page",
            reason: "purchase:completed",
            force: true,
          });
          await refreshLibrary({
            source: "success/page",
            reason: attempt === 0 ? "initial" : `poll-${attempt}`,
          });

          if (attempt === 0) {
            notifyEntitlementsUpdated({
              source: "success/page",
              reason: "purchase-confirmed",
            });
          }

          const owned = new Set(account?.ownedSlugs || []);

          if (!expectedSlugs.length) {
            const orderHistory = await loadPurchases();
            if (cancelled) return;
            if (sessionId) {
              const match = orderHistory.find(
                (p) => p.stripe_checkout_session_id === sessionId
              );
              expectedSlugs = slugsFromPurchaseRecord(match);
            }
          }

          const pending =
            expectedSlugs.length > 0 &&
            expectedSlugs.some((slug) => !owned.has(slug));

          if (!pending) break;

          const ownedKey = [...owned].sort().join(",");
          if (attempt > 0 && ownedKey === prevOwnedKey) break;
          prevOwnedKey = ownedKey;
        }

        const orderHistory = await loadPurchases();
        if (!cancelled) {
          setPurchases(orderHistory);
          setCollected(pickCollectedItem(orderHistory, sessionId, expectedSlugs));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Network error. Could not load purchases.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshLibrary, refreshAccountState, invalidateEntitlementSnapshot, searchParams]);

  useEffect(() => {
    if (loading) return undefined;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  const handleGoToCollection = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    sessionStorage.setItem("openTab", "mymusic");
    window.setTimeout(() => {
      router.push("/");
    }, 450);
  }, [exiting, router]);

  const displayTitle = collected?.title || "Collected";
  const displaySubtitle = collected?.subtitle || "Now in your collection";

  const pageWrapperStyle = {
    minHeight: "100vh",
    background: "#050505",
    color: "white",
    fontFamily: "sans-serif",
    position: "relative",
    overflow: "hidden",
    transform: exiting ? "translateY(-100%)" : "translateY(0)",
    transition: "transform 400ms ease-in-out",
    transitionDelay: exiting ? "50ms" : "0ms",
  };

  const ambientStyle = {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 0,
    background: collected?.cover
      ? `url(${collected.cover}) center/cover`
      : "radial-gradient(circle at 50% 30%, rgba(0,255,255,0.12) 0%, transparent 55%), #050505",
    filter: "blur(90px) saturate(1.25) brightness(0.55)",
    opacity: exiting ? 0 : entered ? 0.55 : 0,
    transition: exiting ? "opacity 400ms ease-in" : "opacity 800ms ease-out",
  };

  const contentWrapperStyle = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    transform: exiting
      ? "translateY(-40px) scale(1.04)"
      : entered
        ? "translateY(0) scale(1)"
        : "translateY(20px) scale(0.96)",
    opacity: exiting ? 0 : entered ? 1 : 0,
    transition: exiting
      ? "all 350ms ease-in"
      : "opacity 700ms ease-out, transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  const buttonScale = buttonPressed ? 0.96 : 1;

  return (
    <div style={pageWrapperStyle}>
      <div aria-hidden style={ambientStyle} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px 56px",
        }}
      >
        {loading ? (
          <p style={{ color: "#555", fontSize: 13, letterSpacing: 2 }}>Confirming your collection…</p>
        ) : (
          <>
            <div style={contentWrapperStyle}>
              <div
                style={{
                  width: "min(72vw, 280px)",
                  aspectRatio: "1",
                  marginBottom: 28,
                  borderRadius: 20,
                  overflow: "hidden",
                  boxShadow: "0 0 40px rgba(0,255,255,0.25)",
                }}
              >
                <CoverArt
                  src={collected?.cover}
                  type={collected?.coverArtType || "image"}
                  alt={displayTitle}
                  width="100%"
                  height="100%"
                  borderRadius={20}
                />
              </div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: 6,
                  color: "#00ffff",
                  fontWeight: 800,
                  marginBottom: 12,
                  textShadow: "0 0 16px rgba(0,255,255,0.45)",
                }}
              >
                COLLECTED.
              </div>
              <h1
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  margin: "0 0 10px",
                  letterSpacing: 1,
                  lineHeight: 1.15,
                  maxWidth: 320,
                }}
              >
                {displayTitle}
              </h1>
              <p style={{ color: "#888", fontSize: 14, margin: 0, maxWidth: 300, lineHeight: 1.5 }}>
                {error ? error : displaySubtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={handleGoToCollection}
              onMouseDown={() => setButtonPressed(true)}
              onMouseUp={() => setButtonPressed(false)}
              onMouseLeave={() => setButtonPressed(false)}
              onTouchStart={() => setButtonPressed(true)}
              onTouchEnd={() => setButtonPressed(false)}
              disabled={exiting}
              style={{
                marginTop: 40,
                padding: "14px 32px",
                background: "#111",
                color: "#00ffff",
                border: "1px solid #00ffff",
                borderRadius: 10,
                fontWeight: 800,
                fontSize: 12,
                letterSpacing: 2,
                cursor: exiting ? "default" : "pointer",
                transform: `scale(${buttonScale})`,
                transition: "transform 0.1s ease",
                opacity: exiting ? 0.6 : 1,
              }}
            >
              Go to My Music Collection
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            background: "#050505",
            color: "white",
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Loading…
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
