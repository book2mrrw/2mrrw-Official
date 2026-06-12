import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";
import { clearStreamSession, endStreamEvent } from "@/lib/playback/stream-pipeline";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const streamEventId = body.streamEventId || null;
  const sessionId = body.sessionId || null;
  const durationSeconds = Math.max(0, Math.floor(Number(body.durationSeconds) || 0));
  const completed = Boolean(body.completed);

  try {
    const admin = createAdminClient();
    await endStreamEvent(admin, streamEventId, { durationSeconds, completed });
    await clearStreamSession(admin, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stream/end] failed", { userId: user.id, streamEventId, err: err?.message });
    return NextResponse.json({ error: "Could not end stream" }, { status: 500 });
  }
}
