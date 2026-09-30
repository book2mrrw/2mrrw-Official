import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getActiveMembership, canAccessVaultTier } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { getUserVaultAccess, loadVaultContentBySlug } from "@/lib/vault/access";
import { buildR2Key, createR2SignedGetUrl, R2_PREFIX } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

/**
 * Top-level R2 prefixes that mean "this is already a complete object key".
 *
 * Older vault rows store a path relative to digital-assets/, which is what
 * buildR2Key below is for. Anything uploaded through Vault Manager stores the
 * full key instead (videos/vault/...), and prefixing that produced
 * digital-assets/videos/vault/... -- a key that does not exist. The signed URL
 * came back fine and then 404'd on fetch, so playback fell through to nothing
 * with no error to explain it.
 */
const R2_ABSOLUTE_PREFIXES = ["videos/", "digital-assets/", "protected-media/", "hls/"];

function resolveVaultObjectKey(storagePath) {
  const path = String(storagePath || "").replace(/^\//, "");
  if (R2_ABSOLUTE_PREFIXES.some((prefix) => path.startsWith(prefix))) return path;
  return buildR2Key(R2_PREFIX.DIGITAL_ASSETS, path);
}

export async function GET(req) {
  try {
    const slug = req.nextUrl.searchParams.get("slug");
    const mode = req.nextUrl.searchParams.get("mode") || "media";
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }

    const admin = getAdminClient();
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

    const key = resolveVaultObjectKey(storagePath);
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
