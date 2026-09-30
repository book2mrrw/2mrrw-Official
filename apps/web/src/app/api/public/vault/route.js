import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getActiveMembership } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getUserVaultAccess, loadPublishedVaultContent } from "@/lib/vault/access";
import { createR2SignedGetUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const VAULT_PASS_REGULAR_CENTS = 7000;
const VAULT_PASS_SUBSCRIBER_CENTS = 2799;

/** Long enough that a chamber left open all evening keeps its covers, short
 *  enough that a leaked URL is not a permanent one. Matches the vault video
 *  token's 8h window. */
const COVER_URL_TTL_SECONDS = 28_800;

/**
 * Signed URLs for each section's pod cover.
 *
 * These objects live under videos/vault/_section-covers/, which is in
 * R2_NEVER_PUBLIC_PREFIXES -- so they cannot simply be linked, and every URL
 * has to be signed per request. Signing is a local HMAC with no network call,
 * so doing all sixteen (a still and a loop per section) costs nothing.
 *
 * Resolved here rather than through a per-pod endpoint because the chamber
 * paints eight pods at once; eight extra round trips to fill them would be
 * visible as pods popping in one at a time.
 */
async function loadSectionCovers(admin) {
  const { data, error } = await admin
    .from("vault_section_covers")
    .select("category, motion_key, still_key");

  if (error) {
    // A missing cover leaves a pod looking plain. That is not worth failing
    // the whole Vault payload over.
    console.error("vault section covers load failed:", error.message);
    return {};
  }

  const out = {};
  await Promise.all(
    (data || []).map(async (row) => {
      const [still, motion] = await Promise.all([
        row.still_key ? createR2SignedGetUrl(row.still_key, COVER_URL_TTL_SECONDS).catch(() => null) : null,
        row.motion_key ? createR2SignedGetUrl(row.motion_key, COVER_URL_TTL_SECONDS).catch(() => null) : null,
      ]);
      if (still || motion) out[row.category] = { still, motion };
    })
  );
  return out;
}

export async function GET() {
  try {
    const admin = getAdminClient();
    const user = (await getFanSessionUser()) ?? (await getGuestUser());
    const isAdminTester = isAdminUser(user);
    const membership = user ? await getActiveMembership(user.id) : null;
    const vaultAccess = await getUserVaultAccess(admin, user?.id, membership);
    // Admins always see the Vault as if fully unlocked -- lets the account
    // that owns this platform test the real door/gesture/shelf experience
    // without needing a live Vault Pass purchase or collector card.
    const effectiveTier = isAdminTester ? "vault_pass" : vaultAccess.tier;
    const sections = await loadPublishedVaultContent(admin, effectiveTier);

    const { data: vaultPassProduct } = await admin
      .from("products")
      .select("price_cents, metadata")
      .eq("slug", "vault-pass")
      .maybeSingle();

    const subscriberPrice = vaultPassProduct?.price_cents ?? VAULT_PASS_SUBSCRIBER_CENTS;
    const hasSubscriber = Boolean(membership && ["active", "trialing"].includes(membership.status));
    const cardOwnerFree = Boolean(vaultAccess.collectorAccess?.hasCollectorAccess);

    const pricing = {
      regularCents: VAULT_PASS_REGULAR_CENTS,
      subscriberCents: subscriberPrice,
      displayRegular: `$${(VAULT_PASS_REGULAR_CENTS / 100).toFixed(2)}`,
      displaySubscriber: `$${(subscriberPrice / 100).toFixed(2)}`,
      cardOwnerFree,
      hasSubscriber,
    };

    const unlocked = vaultAccess.fullAccess || cardOwnerFree || isAdminTester;
    const gatedSections = sections;

    // Only signed for a viewer who can actually open the door. The pods that
    // show these live inside the chamber, which a locked viewer never reaches,
    // so signing them for one would hand out media for nothing.
    const sectionCovers = unlocked ? await loadSectionCovers(admin) : {};

    return NextResponse.json({
      unlocked,
      pricing,
      vaultAccess: {
        tier: effectiveTier,
        hasInnerCircleAccess: vaultAccess.hasInnerCircleAccess,
        hasVaultPass: vaultAccess.hasVaultPass,
        fullAccess: vaultAccess.fullAccess,
        cardOwnerFree,
        isAdminPreview: isAdminTester,
      },
      sections: unlocked ? gatedSections : gatedSections.filter((row) => row.accessTier === "public"),
      sectionCovers,
      room: unlocked
        ? {
            mode: "unlocked",
            shelfCount: gatedSections.length,
            glowItems: gatedSections.filter((row) => row.metadata?.glowEffect || row.feature).map((row) => row.slug),
          }
        : { mode: "locked" },
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("public vault error:", err);
    return NextResponse.json({
      unlocked: false,
      pricing: {
        regularCents: VAULT_PASS_REGULAR_CENTS,
        subscriberCents: VAULT_PASS_SUBSCRIBER_CENTS,
        displayRegular: `$${(VAULT_PASS_REGULAR_CENTS / 100).toFixed(2)}`,
        displaySubscriber: `$${(VAULT_PASS_SUBSCRIBER_CENTS / 100).toFixed(2)}`,
        cardOwnerFree: false,
        hasSubscriber: false,
      },
      vaultAccess: {
        tier: "public",
        hasInnerCircleAccess: false,
        hasVaultPass: false,
        fullAccess: false,
        cardOwnerFree: false,
      },
      sections: [],
      sectionCovers: {},
      room: { mode: "locked" },
      source: "fallback",
      syncedAt: new Date().toISOString(),
    });
  }
}
