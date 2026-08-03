import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveMembership } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { getUserVaultAccess, loadPublishedVaultContent } from "@/lib/vault/access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminClient();
    const user = await getGuestUser();
    const membership = user ? await getActiveMembership(user.id) : null;
    const vaultAccess = await getUserVaultAccess(admin, user?.id, membership);
    const sections = await loadPublishedVaultContent(admin, vaultAccess.tier);

    return NextResponse.json({
      sections,
      vaultAccess: {
        tier: vaultAccess.tier,
        hasInnerCircleAccess: vaultAccess.hasInnerCircleAccess,
        hasVaultPass: vaultAccess.hasVaultPass,
        selectedAccess: vaultAccess.selectedAccess,
        fullAccess: vaultAccess.fullAccess,
      },
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("vault content error:", err);
    return NextResponse.json({ error: err.message || "Vault content failed" }, { status: 500 });
  }
}
