import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

const MAX_QUEUE_STORE = 50;

export async function GET(req) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ queue: null });

  const limit = await checkRateLimit(req, { routeKey: "queue.get", limit: 30, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_playback_queue")
    .select("queue, queue_index, shuffle, repeat_mode, saved_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ queue: null });
  if (!data) return NextResponse.json({ queue: null });

  return NextResponse.json({
    queue: data.queue || [],
    queueIndex: data.queue_index || 0,
    shuffle: Boolean(data.shuffle),
    repeatMode: data.repeat_mode || "off",
    savedAt: data.saved_at,
  });
}

export async function PUT(req) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ ok: false });

  const limit = await checkRateLimit(req, { routeKey: "queue.save", limit: 60, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await req.json().catch(() => ({}));
  const { queue, queueIndex, shuffle, repeatMode } = body;

  if (!Array.isArray(queue)) return NextResponse.json({ error: "queue array required" }, { status: 400 });

  const admin = getAdminClient();
  const { error } = await admin.from("user_playback_queue").upsert(
    {
      user_id: user.id,
      queue: queue.slice(0, MAX_QUEUE_STORE),
      queue_index: Number(queueIndex) || 0,
      shuffle: Boolean(shuffle),
      repeat_mode: repeatMode || "off",
      saved_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
