import { createClient } from "@supabase/supabase-js";

let _adminClient = null;

export function normalizeServerEnvironmentValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getSupabaseSecretKey() {
  return normalizeServerEnvironmentValue(process.env.SUPABASE_SECRET_KEY);
}

/**
 * Module-level singleton service-role client.
 *
 * On Vercel serverless, the module cache persists across warm invocations on the
 * same instance. Reusing one client avoids re-initialising the Supabase SDK,
 * re-establishing the underlying HTTP connection pool, and re-parsing credentials
 * on every call — cutting 4–5 redundant client constructions per audio play event.
 *
 * Server-only. Never expose to the browser or pass the service-role key to the client.
 */
export function getAdminClient() {
  if (_adminClient) return _adminClient;
  const url = normalizeServerEnvironmentValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = getSupabaseSecretKey();
  if (!url || !key) throw new Error("Missing Supabase admin credentials");
  _adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}

/** @deprecated Use getAdminClient() for singleton access. Kept for backward compatibility. */
export function createAdminClient() {
  return getAdminClient();
}
