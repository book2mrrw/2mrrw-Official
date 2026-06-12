import { createAdminClient } from "@/lib/supabase/admin";

export const STREAM_SIGNED_URL_TTL_SECONDS = 3600;
export const STREAM_SESSION_OVERLAP_SECONDS = 30;

function isMissingTable(error) {
  const code = error?.code || "";
  const msg = String(error?.message || "");
  return code === "42P01" || /relation .* does not exist/i.test(msg);
}

export async function resolveProductIdBySlug(admin, slug) {
  const { data, error } = await admin.from("products").select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

export async function findActiveStreamSession(admin, userId, productId) {
  const since = new Date(Date.now() - STREAM_SESSION_OVERLAP_SECONDS * 1000).toISOString();
  const { data, error } = await admin
    .from("stream_sessions")
    .select("session_id, started_at, expires_at")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .gte("started_at", since)
    .gt("expires_at", new Date().toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data || null;
}

export async function createStreamSession(admin, userId, productId) {
  const expiresAt = new Date(Date.now() + STREAM_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  const { data, error } = await admin
    .from("stream_sessions")
    .insert({
      user_id: userId,
      product_id: productId,
      expires_at: expiresAt,
    })
    .select("session_id")
    .single();

  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data?.session_id || null;
}

export async function clearStreamSession(admin, sessionId) {
  if (!sessionId) return;
  const { error } = await admin.from("stream_sessions").delete().eq("session_id", sessionId);
  if (error && !isMissingTable(error)) throw error;
}

export async function clearStreamSessionsForUserProduct(admin, userId, productId) {
  const { error } = await admin
    .from("stream_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId);
  if (error && !isMissingTable(error)) throw error;
}

export async function insertStreamEvent(admin, userId, productId) {
  const { data, error } = await admin
    .from("stream_events")
    .insert({
      user_id: userId,
      product_id: productId,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data?.id || null;
}

export async function endStreamEvent(admin, streamEventId, { durationSeconds = 0, completed = false } = {}) {
  if (!streamEventId) return;
  const { error } = await admin
    .from("stream_events")
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: Math.max(0, Math.floor(Number(durationSeconds) || 0)),
      completed: Boolean(completed),
    })
    .eq("id", streamEventId);

  if (error && !isMissingTable(error)) throw error;
}
