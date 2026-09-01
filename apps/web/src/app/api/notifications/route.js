import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";
import {
  getNotificationState,
  isMissingNotificationsTable,
  updateNotificationPreferences,
} from "@/lib/notifications";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const rl = await checkRateLimit(req, { routeKey: "notifications.get", limit: 60, windowSeconds: 60 });
  if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({
        preferences: null,
        summary: { unreadCount: 0, latest: [] },
      });
    }

    const admin = getAdminClient();
    const state = await getNotificationState(admin, user.id);
    return NextResponse.json({ ...state, syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error("notifications get error:", err);
    return NextResponse.json({ error: err.message || "Notifications failed" }, { status: 500 });
  }
}

export async function PATCH(req) {
  const rl = await checkRateLimit(req, { routeKey: "notifications.patch", limit: 10, windowSeconds: 60 });
  if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ error: "Enter email and phone before changing alerts" }, { status: 401 });
    }

    const body = await req.json();
    const admin = getAdminClient();
    const preferences = await updateNotificationPreferences(admin, user.id, body.preferences || body);
    const state = await getNotificationState(admin, user.id);

    return NextResponse.json({
      ok: true,
      preferences,
      summary: state.summary,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (isMissingNotificationsTable(err)) {
      return NextResponse.json({ error: "Notification tables are not installed yet" }, { status: 503 });
    }
    console.error("notifications preference error:", err);
    return NextResponse.json({ error: err.message || "Notification settings failed" }, { status: 500 });
  }
}

export async function POST(req) {
  const rl = await checkRateLimit(req, { routeKey: "notifications.post", limit: 30, windowSeconds: 60 });
  if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ error: "Enter email and phone before updating notifications" }, { status: 401 });
    }

    const { action, ids = [] } = await req.json();
    const admin = getAdminClient();
    let query = admin
      .from("notification_inbox")
      .update(action === "archive" ? { archived_at: new Date().toISOString() } : { read_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (Array.isArray(ids) && ids.length > 0) {
      query = query.in("id", ids);
    } else {
      query = query.is("archived_at", null);
    }

    const { error } = await query;
    if (error) throw error;

    const state = await getNotificationState(admin, user.id);
    return NextResponse.json({ ok: true, ...state, syncedAt: new Date().toISOString() });
  } catch (err) {
    if (isMissingNotificationsTable(err)) {
      return NextResponse.json({ error: "Notification tables are not installed yet" }, { status: 503 });
    }
    console.error("notifications update error:", err);
    return NextResponse.json({ error: err.message || "Notification update failed" }, { status: 500 });
  }
}
