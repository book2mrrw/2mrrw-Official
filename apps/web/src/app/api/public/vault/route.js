import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getActiveMembership } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { getUserVaultAccess, loadPublishedVaultContent } from "@/lib/vault/access";

export const dynamic = "force-dynamic";

const VAULT_PASS_REGULAR_CENTS = 7000;
const VAULT_PASS_SUBSCRIBER_CENTS = 2799;

export async function GET() {
  try {
    const admin = getAdminClient();
    const user = await getGuestUser();
    const membership = user ? await getActiveMembership(user.id) : null;
    const vaultAccess = await getUserVaultAccess(admin, user?.id, membership);
    const sections = await loadPublishedVaultContent(admin, vaultAccess.tier);

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

    const unlocked = vaultAccess.fullAccess || cardOwnerFree;
    const gatedSections = sections;

    return NextResponse.json({
      unlocked,
      pricing,
      vaultAccess: {
        tier: vaultAccess.tier,
        hasInnerCircleAccess: vaultAccess.hasInnerCircleAccess,
        hasVaultPass: vaultAccess.hasVaultPass,
        fullAccess: vaultAccess.fullAccess,
        cardOwnerFree,
      },
      sections: unlocked ? gatedSections : gatedSections.filter((row) => row.accessTier === "public"),
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
      room: { mode: "locked" },
      source: "fallback",
      syncedAt: new Date().toISOString(),
    });
  }
}
