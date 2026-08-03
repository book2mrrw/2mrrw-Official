import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveMembership, canAccessVaultTier } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { getUserVaultAccess, loadVaultContentBySlug } from "@/lib/vault/access";
import { buildR2Key, createR2SignedGetUrl, R2_PREFIX } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const slug = req.nextUrl.searchParams.get("slug");
    const mode = req.nextUrl.searchParams.get("mode") || "media";
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const content = await loadVaultContentBySlug(admin, slug);
    if (!content) {
      return NextResponse.json({ error: "Vault content not found" }, { status: 404 });
    }

    const user = await getGuestUser();
    const membership = user ? await getActiveMembership(user.id) : null;
    const vaultAccess = await getUserVaultAccess(admin, user?.id, membership);
    const requestedPreview = mode === "preview";
    const unlocked = canAccessVaultTier(vaultAccess.tier, content.access_tier);
    const externalUrl = requestedPreview
      ? content.preview_url || content.metadata?.preview_url
      : content.content_url || content.metadata?.content_url;
    const storagePath = requestedPreview ? content.preview_storage_path : content.media_storage_path;

    if (!requestedPreview && !unlocked) {
      return NextResponse.json({ error: "Vault entitlement required", requiredTier: content.access_tier }, { status: 403 });
    }
    if (externalUrl) {
      return NextResponse.json({
        url: externalUrl,
        expiresIn: null,
        content: {
          slug: content.slug,
          title: content.title,
          category: content.category,
          mediaType: content.media_type,
          accessTier: content.access_tier,
        },
        vaultAccess: { tier: vaultAccess.tier, unlocked },
      });
    }
    if (!storagePath) {
      return NextResponse.json({ error: requestedPreview ? "No preview asset available" : "No media asset available" }, { status: 404 });
    }

    const key = buildR2Key(R2_PREFIX.DIGITAL_ASSETS, storagePath);
    const url = await createR2SignedGetUrl(key, 3600);

    return NextResponse.json({
      url,
      expiresIn: 3600,
      content: {
        slug: content.slug,
        title: content.title,
        category: content.category,
        mediaType: content.media_type,
        accessTier: content.access_tier,
      },
      vaultAccess: { tier: vaultAccess.tier, unlocked },
    });
  } catch (err) {
    console.error("vault media error:", err);
    return NextResponse.json({ error: err.message || "Vault media failed" }, { status: 500 });
  }
}
