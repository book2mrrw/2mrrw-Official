import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.draft",
    limit: 20,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const { release_type, slug: requestedSlug, upload_session_id: uploadSessionId } = body;

  const VALID_TYPES = ["single", "feature", "album", "ep", "mixtape"];
  if (!VALID_TYPES.includes(release_type)) {
    return NextResponse.json({ error: `release_type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  const admin = getAdminClient();

  if (!uploadSessionId || !/^[a-f0-9-]{36}$/i.test(uploadSessionId)) {
    return NextResponse.json({ error: "A valid upload_session_id is required" }, { status: 400 });
  }

  // Draft creation is idempotent for the lifetime of an upload session.
  const { data: existingDraft, error: existingError } = await admin
    .from("releases")
    .select("id, slug, status, release_type")
    .eq("status", "draft")
    .contains("metadata", { upload_session_id: uploadSessionId })
    .maybeSingle();
  if (existingError) {
    console.error("[admin/releases/draft] lookup error", existingError.message);
    return NextResponse.json({ error: "Failed to recover release draft" }, { status: 500 });
  }
  if (existingDraft) {
    return NextResponse.json({
      release_id: existingDraft.id,
      slug: existingDraft.slug,
      status: existingDraft.status,
      release_type: existingDraft.release_type,
      recovered: true,
    });
  }

  // Derive final slug: prefer caller-supplied title-based slug, deduplicate if taken
  const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
  let draftSlug;
  if (requestedSlug && SLUG_RE.test(requestedSlug)) {
    let candidate = requestedSlug;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const { data: existing } = await admin
        .from("releases").select("id").eq("slug", candidate).maybeSingle();
      if (!existing) { draftSlug = candidate; break; }
      candidate = `${requestedSlug}-${attempt + 1}`;
    }
  }
  if (!draftSlug) {
    draftSlug = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const { data, error } = await admin
    .from("releases")
    .insert({
      release_type,
      status: "draft",
      storefront_visible: false,
      slug: draftSlug,
      metadata: { upload_session_id: uploadSessionId },
    })
    .select("id, slug, status, release_type")
    .single();

  if (error) {
    console.error("[admin/releases/draft] insert error", error.message);
    return NextResponse.json({ error: "Failed to create draft" }, { status: 500 });
  }

  return NextResponse.json({ release_id: data.id, slug: data.slug, release_type: data.release_type, recovered: false });
}
