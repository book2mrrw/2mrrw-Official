import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCommunityIdentitySnapshot } from "@/lib/community/identity";
import { getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const ALLOWED_SECTIONS = new Set(["blog", "vision", "innercircle", "live"]);

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function mapComment(row) {
  return {
    id: row.id,
    section: row.section_key,
    itemId: row.item_id,
    name: row.display_name,
    badge: row.badge,
    text: row.content,
    time: row.created_at,
    isCreator: row.is_creator,
    featured: row.is_featured,
    subscriber: row.subscriber_snapshot,
    collector: row.collector_snapshot,
    innerCircle: row.inner_circle_snapshot,
  };
}

export async function GET(req) {
  try {
    const rl = await checkRateLimit(req, {
      routeKey: "community-comments.get",
      limit: 30,
      windowSeconds: 60,
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

    const section = req.nextUrl.searchParams.get("section");
    const itemId = req.nextUrl.searchParams.get("itemId");

    if (!ALLOWED_SECTIONS.has(section) || !itemId) {
      return NextResponse.json({ error: "section and itemId required" }, { status: 400 });
    }

    const admin = createAdminClient();
    if (section === "innercircle") {
      const user = await getGuestUser();
      if (!user) {
        return NextResponse.json({ error: "Inner Circle access required" }, { status: 401 });
      }
      const identity = await getCommunityIdentitySnapshot(admin, user);
      if (!identity.innerCircle && !identity.creator) {
        return NextResponse.json({ error: "Inner Circle access required" }, { status: 403 });
      }
    }
    const { data, error } = await admin
      .from("community_comments")
      .select("id, section_key, item_id, display_name, badge, content, is_creator, is_featured, subscriber_snapshot, collector_snapshot, inner_circle_snapshot, created_at")
      .eq("section_key", section)
      .eq("item_id", itemId)
      .eq("moderation_state", "approved")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ comments: (data || []).map(mapComment), syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error("community comments load error:", err);
    return NextResponse.json({ error: err.message || "Comments failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ error: "Enter email and phone before commenting" }, { status: 401 });
    }

    const limit = await checkRateLimit(req, {
      routeKey: "community-comments",
      limit: 30,
      windowSeconds: 300,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const body = await req.json();
    const section = body.section;
    const itemId = cleanText(body.itemId, 160);
    const content = cleanText(body.content, 1200);

    if (!ALLOWED_SECTIONS.has(section) || !itemId || !content) {
      return NextResponse.json({ error: "section, itemId, and content required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const identity = await getCommunityIdentitySnapshot(admin, user);
    if (section === "innercircle" && !identity.innerCircle) {
      return NextResponse.json({ error: "Inner Circle access required" }, { status: 403 });
    }
    const { error } = await admin.from("community_comments").insert({
      section_key: section,
      item_id: itemId,
      user_id: user.id,
      display_name: identity.displayName,
      badge: identity.badge,
      content,
      is_creator: identity.creator,
      is_featured: Boolean(identity.creator && body.featured),
      subscriber_snapshot: identity.subscriber,
      collector_snapshot: identity.collector,
      inner_circle_snapshot: identity.innerCircle,
    });

    if (error) throw error;

    const { data, error: loadError } = await admin
      .from("community_comments")
      .select("id, section_key, item_id, display_name, badge, content, is_creator, is_featured, subscriber_snapshot, collector_snapshot, inner_circle_snapshot, created_at")
      .eq("section_key", section)
      .eq("item_id", itemId)
      .eq("moderation_state", "approved")
      .order("created_at", { ascending: true });

    if (loadError) throw loadError;
    return NextResponse.json({ ok: true, comments: (data || []).map(mapComment), syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error("community comment write error:", err);
    return NextResponse.json({ error: err.message || "Comment failed" }, { status: 500 });
  }
}
