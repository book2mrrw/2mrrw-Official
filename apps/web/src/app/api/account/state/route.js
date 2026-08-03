import { NextResponse } from "next/server";
import { getCachedState, setCachedState } from "@/lib/server/account-state-cache";
import { getCollectorAccessRecords } from "@/lib/collector-cards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCollectorAccessState,
  getVaultPassAccessState,
  isDigitalProduct,
  isMissingCollectorOwnershipsTable,
  isMissingSupabaseTable,
  membershipHasPremiumAccess,
  vaultTierFor,
} from "@/lib/commerce/entitlements";
import { getUserEntitlements, hasEntitlement, hasVaultAccess } from "@/lib/entitlements";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  clearGuestCookie,
  clearGuestCookieOnResponse,
  getGuestSessionCookieState,
  withGuestCookie,
} from "@/lib/guest-session";
import { DEFAULT_NOTIFICATION_PREFERENCES, getNotificationState } from "@/lib/notifications";
import { deriveUserTier, derivePlaybackPolicy } from "@/lib/playback/playback-policy";

function permissionsFor({ membership, hasCollectorAccess, hasVaultPass, isGuest = true, user = null, userEntitlements = null }) {
  const hasActiveMembership = membershipHasPremiumAccess(membership) || hasEntitlement(userEntitlements, "subscriber");
  const hasCollectorFromFlags = hasEntitlement(userEntitlements, "collector_card");
  const effectiveCollector = hasCollectorAccess || hasCollectorFromFlags;
  const hasInnerCircleAccess = hasActiveMembership || effectiveCollector;
  const vaultFromFlags = hasEntitlement(userEntitlements, "vault_access");
  const effectiveVaultPass = hasVaultPass || effectiveCollector || vaultFromFlags;
  const vaultTier = vaultTierFor({ hasVaultPass: effectiveVaultPass, hasInnerCircleAccess });

  return {
    guest: isGuest,
    subscriber: Boolean(hasActiveMembership),
    collectorAccess: Boolean(effectiveCollector),
    innerCircle: Boolean(hasInnerCircleAccess),
    premiumLivestreams: Boolean(hasInnerCircleAccess),
    vaultPass: Boolean(effectiveVaultPass),
    vaultTier,
    vaultAccessLevel: vaultTier,
    vaultFullAccess: vaultTier === "vault_pass",
    vaultSelectedAccess: vaultTier === "inner_circle" || vaultTier === "vault_pass",
    collector: effectiveCollector,
    creator: false,
    admin: isAdminUser(user),
    entitlements: userEntitlements
      ? {
          vault_access: Boolean(userEntitlements.vault_access),
          subscriber: Boolean(userEntitlements.subscriber),
          collector_card: Boolean(userEntitlements.collector_card),
        }
      : null,
  };
}

export async function GET(req) {
  try {
    const session = await getGuestSessionCookieState();
    if (session?.expired) {
      return clearGuestCookie({ user: null, expired: true });
    }

    const user = await getFanSessionUser();

    const limit = await checkRateLimit(req, {
      routeKey: "account.state",
      limit: 120,
      windowSeconds: 60,
      identifier: user?.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const forceRefresh = new URL(req.url).searchParams.get("force") === "1";

    if (user && !user.isGuest && !forceRefresh) {
      const cached = await getCachedState(user.id);
      if (cached) return clearGuestCookieOnResponse(NextResponse.json(cached));
    }

    if (!user) {
      return NextResponse.json({
        user: null,
        library: [],
        ownedSlugs: [],
        membership: null,
        collectorOwnerships: [],
        vaultAccess: false,
        vaultAccessDetail: { tier: "public", hasVaultPass: false, hasInnerCircleAccess: false },
        subscriberActive: false,
        collectorCard: false,
        mediaProgress: [],
        notifications: {
          preferences: DEFAULT_NOTIFICATION_PREFERENCES,
          summary: { unreadCount: 0, latest: [] },
          available: false,
        },
        permissions: permissionsFor({ membership: null, hasCollectorAccess: false, hasVaultPass: false, user: null }),
        session: null,
      });
    }

    const admin = createAdminClient();
    const [libraryResult, membershipResult, productsResult, collectorResult, mediaProgressResult, collectorAccessRecords] = await Promise.all([
      admin
        .from("library_items")
        .select("id, source, granted_at, products (slug, title, product_type, cover_url, storage_path)")
        .eq("user_id", user.id)
        .order("granted_at", { ascending: false }),
      admin
        .from("memberships")
        .select("tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, started_at, canceled_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("products")
        .select("slug, title, product_type, cover_url, storage_path")
        .eq("active", true)
        .limit(10000),
      admin
        .from("collector_ownerships")
        .select("id, product_slug, title, collector_type, sku, version, verification_status, entitlement_status, shipping_country, shipping_state, shipping_city, purchased_at, verified_at")
        .eq("user_id", user.id)
        .order("purchased_at", { ascending: false }),
      admin
        .from("media_playback_progress")
        .select("product_slug, media_type, position_seconds, duration_seconds, completed, replay_count, last_played_at")
        .eq("user_id", user.id)
        .order("last_played_at", { ascending: false })
        .limit(100),
      getCollectorAccessRecords(admin, user.id),
    ]);

    if (libraryResult.error) {
      return NextResponse.json({ error: libraryResult.error.message }, { status: 500 });
    }
    if (membershipResult.error) {
      return NextResponse.json({ error: membershipResult.error.message }, { status: 500 });
    }
    if (productsResult.error) {
      return NextResponse.json({ error: productsResult.error.message }, { status: 500 });
    }
    if (collectorResult.error && !isMissingCollectorOwnershipsTable(collectorResult.error)) {
      return NextResponse.json({ error: collectorResult.error.message }, { status: 500 });
    }
    if (mediaProgressResult.error && !isMissingSupabaseTable(mediaProgressResult.error)) {
      return NextResponse.json({ error: mediaProgressResult.error.message }, { status: 500 });
    }

    const purchasedLibrary = (libraryResult.data || []).map((row) => ({
      slug: row.products?.slug,
      title: row.products?.title,
      product_type: row.products?.product_type,
      cover: row.products?.cover_url,
      source: row.source,
      gifted: row.source === "gift",
      purchasedAt: row.granted_at,
    }));
    const membership = membershipResult.data || null;
    const bySlug = new Map(purchasedLibrary.map((item) => [item.slug, item]));
    const legacyOwnedSlugs = purchasedLibrary.map((item) => item.slug).filter(Boolean);
    const [collectorAccess, vaultPassAccess, notificationState, userEntitlements] = await Promise.all([
      getCollectorAccessState(admin, user.id, legacyOwnedSlugs),
      getVaultPassAccessState(admin, user.id, legacyOwnedSlugs),
      getNotificationState(admin, user.id),
      getUserEntitlements(user.id, admin),
    ]);
    const hasCollectorAccess = collectorAccess.hasCollectorAccess || hasEntitlement(userEntitlements, "collector_card");
    const hasVaultPass = vaultPassAccess.hasVaultPass || hasCollectorAccess || hasEntitlement(userEntitlements, "vault_access");

    const adminFullLibrary = isAdminUser(user);
    if (adminFullLibrary || membershipHasPremiumAccess(membership) || hasCollectorAccess) {
      (productsResult.data || [])
        .filter(isDigitalProduct)
        .forEach((product) => {
          if (!bySlug.has(product.slug)) {
            bySlug.set(product.slug, {
              slug: product.slug,
              title: product.title,
              product_type: product.product_type,
              cover: product.cover_url,
              source: adminFullLibrary
                ? "admin"
                : membershipHasPremiumAccess(membership)
                  ? "membership"
                  : "collector_access",
              gifted: false,
              membershipAccess: !adminFullLibrary && membershipHasPremiumAccess(membership),
              collectorAccess: hasCollectorAccess,
              purchasedAt: null,
            });
          }
        });
    }

    const library = [...bySlug.values()];
    const ledgerActiveSlugs = (collectorResult.data || [])
      .filter((item) => {
        const status = String(item.entitlement_status || item.verification_status || "").toLowerCase();
        return status === "active" || status === "verified" || status === "granted";
      })
      .map((item) => item.product_slug)
      .filter(Boolean);
    const ownedSlugs = [
      ...new Set([...legacyOwnedSlugs, ...ledgerActiveSlugs]),
    ];
    const isAdmin = isAdminUser(user);
    let finalOwnedSlugs = ownedSlugs;
    if (isAdmin && (productsResult.data?.length ?? 0) > 0) {
      finalOwnedSlugs = [
        ...new Set(
          (productsResult.data || [])
            .filter(isDigitalProduct)
            .map((product) => product.slug)
            .filter(Boolean)
        ),
      ];
    }
    const subscriberActive =
      membershipHasPremiumAccess(membership) || hasEntitlement(userEntitlements, "subscriber");
    const collectorCard =
      hasCollectorAccess || hasEntitlement(userEntitlements, "collector_card");
    const vaultAccessFlag =
      hasVaultPass || hasEntitlement(userEntitlements, "vault_access") || hasVaultAccess(userEntitlements);
    const hasInnerCircleAccess = subscriberActive || collectorCard;
    const vaultTier = vaultTierFor({ hasVaultPass, hasInnerCircleAccess });
    const ledgerOwnerships = (collectorResult.data || []).map((item) => ({
      id: item.id,
      slug: item.product_slug,
      title: item.title,
      collectorType: item.collector_type,
      sku: item.sku,
      version: item.version,
      verificationStatus: item.verification_status,
      entitlementStatus: item.entitlement_status,
      region: {
        country: item.shipping_country,
        state: item.shipping_state,
        city: item.shipping_city,
      },
      purchasedAt: item.purchased_at,
      verifiedAt: item.verified_at,
    }));
    const collectorOwnerships = [
      ...collectorAccessRecords.map((item) => ({
        id: item.id,
        slug: item.collectorCardId,
        title: item.releaseName || "Collector Card",
        collectorType: "collector_card",
        visibleSerial: item.visibleSerial,
        releaseName: item.releaseName,
        collectorTier: item.collectorTier,
        collectorStatus: item.collectorStatus,
        verificationStatus: "verified",
        entitlementStatus: item.collectorStatus === "revoked" ? "revoked" : "active",
        access: {
          streaming: item.streamingAccess,
          vault: item.vaultAccess,
          livestream: item.livestreamAccess,
        },
        perks: item.perks,
        verifiedAt: item.updatedAt,
      })),
      ...ledgerOwnerships,
    ];
    const resolvedPermissions = (() => {
      const permissions = permissionsFor({
        membership,
        hasCollectorAccess,
        hasVaultPass,
        isGuest: Boolean(user.isGuest),
        user,
        userEntitlements,
      });
      if (isAdmin) {
        return { ...permissions, subscriber: true };
      }
      return permissions;
    })();
    const tier = deriveUserTier(resolvedPermissions, finalOwnedSlugs);
    const playbackPolicy = derivePlaybackPolicy(tier);

    const body = {
      user,
      library,
      ownedSlugs: finalOwnedSlugs,
      subscriberActive,
      collectorCard,
      vaultAccess: vaultAccessFlag,
      collectorOwnerships,
      membership,
      tier,
      playbackPolicy,
      mediaProgress: (mediaProgressResult.data || []).map((row) => ({
        slug: row.product_slug,
        mediaType: row.media_type,
        positionSeconds: row.position_seconds,
        durationSeconds: row.duration_seconds,
        completed: row.completed,
        replayCount: row.replay_count,
        lastPlayedAt: row.last_played_at,
      })),
      vaultAccessDetail: {
        tier: vaultTier,
        hasVaultPass,
        hasInnerCircleAccess,
        collectorCards: collectorAccessRecords,
        selectedAccess: vaultTier === "inner_circle" || vaultTier === "vault_pass",
        fullAccess: vaultTier === "vault_pass",
        entitlement: vaultPassAccess.entitlement,
      },
      notifications: notificationState,
      permissions: resolvedPermissions,
      userEntitlements: {
        vault_access: Boolean(userEntitlements?.vault_access),
        subscriber: Boolean(userEntitlements?.subscriber),
        collector_card: Boolean(userEntitlements?.collector_card),
        collector_card_id: userEntitlements?.collector_card_id || null,
      },
      session: { remember: Boolean(session?.remember) },
      syncedAt: new Date().toISOString(),
    };

    if (user.isGuest) {
      return withGuestCookie(NextResponse.json(body), user.id, { remember: session?.remember });
    }
    setCachedState(user.id, body).catch(() => {});
    return clearGuestCookieOnResponse(NextResponse.json(body));
  } catch (err) {
    console.error("account state error:", err);
    return NextResponse.json({ error: err.message || "Account state failed" }, { status: 500 });
  }
}
