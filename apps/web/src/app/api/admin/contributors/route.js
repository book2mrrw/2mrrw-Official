import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { creditStorageCapabilities } from "@/lib/credits/admin-store";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
async function gate(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const rl = await checkRateLimit(req, { routeKey: "admin.contributors", limit: 60, windowSeconds: 60, identifier: user.id });
  if (!rl.allowed) return { response: rateLimitResponse(rl.retryAfterSeconds) };
  const admin = getAdminClient();
  const capability = await creditStorageCapabilities(admin);
  if (!capability.ready) return { response: NextResponse.json({ error: capability.reason }, { status: 503 }) };
  return { admin };
}
export async function GET(req) {
  const { response, admin } = await gate(req);
  if (response) return response;
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2 || q.length > 120) return NextResponse.json({ contributors: [] });
  const { data, error } = await admin.from("collaborators").select("id,name").ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`).order("name").order("id").limit(20);
  return error ? NextResponse.json({ error: "Contributor search failed" }, { status: 503 }) : NextResponse.json({ contributors: data }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req) {
  const { response, admin } = await gate(req);
  if (response) return response;
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) return NextResponse.json({ error: "Enter a contributor name (up to 200 characters)" }, { status: 422 });
  // Explicit creation only. Identical names are valid separate people; no name upsert.
  const { data, error } = await admin.from("collaborators").insert({ name: body.name.trim() }).select("id,name").single();
  return error ? NextResponse.json({ error: "Contributor could not be created" }, { status: 503 }) : NextResponse.json({ contributor: data }, { status: 201 });
}
