import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { canAccessVaultTier, getActiveMembership, isMissingSupabaseTable } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { getUserVaultAccess } from "@/lib/vault/access";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { contentId, slug, positionSeconds = 0, completed = false, deviceLabel = "web" } = await req.json();
    if (!contentId && !slug) {
      return NextResponse.json({ error: "contentId or slug required" }, { status: 400 });
    }

    const admin = getAdminClient();
    let resolvedContentId = contentId;
    let content = null;
    if (!resolvedContentId) {
      const { data, error: contentError } = await admin
        .from("vault_content")
        .select("id, access_tier")
        .eq("slug", slug)
        .maybeSingle();
      if (contentError) throw contentError;
      content = data;
      resolvedContentId = content?.id;
    } else {
      const { data, error: contentError } = await admin
        .from("vault_content")
        .select("id, access_tier")
        .eq("id", resolvedContentId)
        .maybeSingle();
      if (contentError) throw contentError;
      content = data;
    }
    if (!resolvedContentId || !content) {
      return NextResponse.json({ error: "Vault content not found" }, { status: 404 });
    }

    const membership = await getActiveMembership(user.id);
    const vaultAccess = await getUserVaultAccess(admin, user.id, membership);
    if (!canAccessVaultTier(vaultAccess.tier, content.access_tier)) {
      return NextResponse.json({ error: "Vault entitlement required", requiredTier: content.access_tier }, { status: 403 });
    }

    const { data, error } = await admin
      .from("vault_content_progress")
      .upsert(
        {
          user_id: user.id,
          content_id: resolvedContentId,
          position_seconds: Math.max(0, Math.floor(Number(positionSeconds) || 0)),
          completed: Boolean(completed),
          last_played_at: new Date().toISOString(),
          device_label: deviceLabel,
        },
        { onConflict: "user_id,content_id" }
      )
      .select("*")
      .single();

    if (error) {
      if (isMissingSupabaseTable(error)) {
        return NextResponse.json({ persisted: false, reason: "vault progress table missing" });
      }
      throw error;
    }

    return NextResponse.json({ persisted: true, progress: data });
  } catch (err) {
    console.error("vault progress error:", err);
    return NextResponse.json({ error: err.message || "Vault progress failed" }, { status: 500 });
  }
}
