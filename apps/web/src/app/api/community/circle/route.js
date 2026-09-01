import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCommunityIdentitySnapshot } from "@/lib/community/identity";
import { getGuestUser } from "@/lib/guest-session";
import { createInAppNotification } from "@/lib/notifications";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const ALLOWED_CATEGORIES = new Set(["thought", "question", "release", "live", "visuals"]);
const ALLOWED_REACTIONS = new Set(["felt", "repeat", "need"]);

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanGifUrl(value) {
  const url = String(value || "").trim();
  if (!url) return null;
  if (!/^https:\/\/.+/i.test(url)) return null;
  return url.slice(0, 500);
}

function reactionCounts(reactions, targetId, target = "post") {
  const key = target === "post" ? "post_id" : "reply_id";
  return { felt: 0, repeat: 0, need: 0, ...Object.fromEntries(
    (reactions || [])
      .filter((reaction) => reaction[key] === targetId)
      .reduce((map, reaction) => map.set(reaction.reaction_key, (map.get(reaction.reaction_key) || 0) + 1), new Map())
  ) };
}

function mapPost(row, reactions) {
  return {
    id: row.id,
    by: row.display_name,
    badge: row.badge,
    text: row.content,
    gif: row.gif_url || "",
    category: row.category,
    time: row.created_at,
    isCreator: row.is_creator,
    pinned: row.is_pinned,
    featured: row.is_featured,
    subscriber: row.subscriber_snapshot,
    collector: row.collector_snapshot,
    innerCircle: row.inner_circle_snapshot,
    reactions: reactionCounts(reactions, row.id, "post"),
    replies: (row.circle_replies || [])
      .filter((reply) => reply.moderation_state === "approved")
      .map((reply) => ({
        id: reply.id,
        by: reply.display_name,
        badge: reply.badge,
        text: reply.content,
        time: reply.created_at,
        isCreator: reply.is_creator,
        featured: reply.is_featured,
        subscriber: reply.subscriber_snapshot,
        collector: reply.collector_snapshot,
        innerCircle: reply.inner_circle_snapshot,
        reactions: reactionCounts(reactions, reply.id, "reply"),
      })),
  };
}

async function loadFeed(admin) {
  const { data: posts, error } = await admin
    .from("circle_posts")
    .select(`
      id,
      display_name,
      badge,
      category,
      content,
      gif_url,
      is_creator,
      is_pinned,
      is_featured,
      moderation_state,
      subscriber_snapshot,
      collector_snapshot,
      inner_circle_snapshot,
      created_at,
      circle_replies (
        id,
        display_name,
        badge,
        content,
        is_creator,
        is_featured,
        moderation_state,
        subscriber_snapshot,
        collector_snapshot,
        inner_circle_snapshot,
        created_at
      )
    `)
    .eq("moderation_state", "approved")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) throw error;

  const postIds = (posts || []).map((post) => post.id);
  const replyIds = (posts || []).flatMap((post) => (post.circle_replies || []).map((reply) => reply.id));
  const reactionFilters = [];
  if (postIds.length) reactionFilters.push(`post_id.in.(${postIds.join(",")})`);
  if (replyIds.length) reactionFilters.push(`reply_id.in.(${replyIds.join(",")})`);

  let reactions = [];
  if (reactionFilters.length) {
    const { data, error: reactionError } = await admin
      .from("circle_reactions")
      .select("post_id, reply_id, reaction_key")
      .or(reactionFilters.join(","));
    if (reactionError) throw reactionError;
    reactions = data || [];
  }

  return (posts || []).map((post) => mapPost(post, reactions));
}

export async function GET(req) {
  try {
    const limit = await checkRateLimit(req, {
      routeKey: "community-circle.get",
      limit: 30,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const admin = getAdminClient();
    const feed = await loadFeed(admin);
    const recentCutoff = new Date(Date.now() - 1000 * 60 * 30).toISOString();
    const { data: recentComments, error: recentError } = await admin
      .from("community_comments")
      .select("section_key, is_creator, subscriber_snapshot, inner_circle_snapshot")
      .eq("moderation_state", "approved")
      .gte("created_at", recentCutoff);
    if (recentError) throw recentError;
    const recent = recentComments || [];
    return NextResponse.json({
      feed,
      presence: {
        creatorActive: feed.some((post) => post.isCreator) || recent.some((comment) => comment.is_creator),
        liveDiscussionActive: feed.some((post) => post.category === "live") || recent.some((comment) => comment.section_key === "live"),
        innerCircleDiscussionActive: feed.some((post) => post.innerCircle) || recent.some((comment) => comment.inner_circle_snapshot),
        subscriberDiscussionCount: feed.filter((post) => post.subscriber).length + recent.filter((comment) => comment.subscriber_snapshot).length,
      },
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("circle feed error:", err);
    return NextResponse.json({ error: err.message || "Circle feed failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ error: "Enter email and phone before posting" }, { status: 401 });
    }

    const limit = await checkRateLimit(req, {
      routeKey: "community-circle",
      limit: 40,
      windowSeconds: 300,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const admin = getAdminClient();
    const identity = await getCommunityIdentitySnapshot(admin, user);
    const body = await req.json();
    const action = body.action || "post";
    if (!identity.innerCircle && !identity.creator) {
      return NextResponse.json({ error: "Inner Circle access required" }, { status: 403 });
    }

    if (action === "post") {
      const content = cleanText(body.content, 2000);
      const category = ALLOWED_CATEGORIES.has(body.category) ? body.category : "thought";
      if (!content) return NextResponse.json({ error: "Post content required" }, { status: 400 });

      const { error } = await admin.from("circle_posts").insert({
        user_id: user.id,
        display_name: identity.displayName,
        badge: identity.badge,
        category,
        content,
        gif_url: cleanGifUrl(body.gifUrl),
        is_creator: identity.creator,
        is_pinned: Boolean(identity.creator && body.pinned),
        is_featured: Boolean(identity.creator && body.featured),
        subscriber_snapshot: identity.subscriber,
        collector_snapshot: identity.collector,
        inner_circle_snapshot: identity.innerCircle,
      });
      if (error) throw error;
    }

    if (action === "reply") {
      const content = cleanText(body.content, 1200);
      if (!content || !body.postId) return NextResponse.json({ error: "Reply content and postId required" }, { status: 400 });

      const { data: parentPost, error: parentPostError } = await admin
        .from("circle_posts")
        .select("user_id, content")
        .eq("id", body.postId)
        .maybeSingle();
      if (parentPostError) throw parentPostError;

      const { data: replyRow, error } = await admin.from("circle_replies").insert({
        post_id: body.postId,
        user_id: user.id,
        display_name: identity.displayName,
        badge: identity.badge,
        content,
        is_creator: identity.creator,
        is_featured: Boolean(identity.creator && body.featured),
        subscriber_snapshot: identity.subscriber,
        collector_snapshot: identity.collector,
        inner_circle_snapshot: identity.innerCircle,
      }).select("id").single();
      if (error) throw error;

      if (parentPost?.user_id && parentPost.user_id !== user.id) {
        await createInAppNotification(admin, {
          userId: parentPost.user_id,
          type: "community_reply",
          title: `${identity.displayName} replied in The Circle`,
          body: content,
          actionUrl: "/?tab=circle",
          metadata: {
            postId: body.postId,
            preview: String(parentPost.content || "").slice(0, 160),
            actorId: user.id,
          },
          dedupKey: replyRow?.id ? `reply:${replyRow.id}` : null,
        });
      }
    }

    if (action === "react") {
      if (!ALLOWED_REACTIONS.has(body.reactionKey)) {
        return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
      }
      if (!body.postId && !body.replyId) {
        return NextResponse.json({ error: "Reaction target required" }, { status: 400 });
      }

      const match = {
        user_id: user.id,
        reaction_key: body.reactionKey,
        ...(body.postId ? { post_id: body.postId } : { reply_id: body.replyId }),
      };
      const { data: existing, error: existingError } = await admin
        .from("circle_reactions")
        .select("id")
        .match(match)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { error } = await admin.from("circle_reactions").delete().eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("circle_reactions").insert({
          ...match,
          subscriber_snapshot: identity.subscriber,
          collector_snapshot: identity.collector,
          inner_circle_snapshot: identity.innerCircle,
        });
        if (error) throw error;
      }
    }

    const feed = await loadFeed(admin);
    return NextResponse.json({ ok: true, feed, syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error("circle write error:", err);
    return NextResponse.json({ error: err.message || "Circle action failed" }, { status: 500 });
  }
}
