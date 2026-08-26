import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

async function guard(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) return { user: null, err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const rl = await checkRateLimit(req, {
    routeKey: "admin.shows",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (rl.limited) return { user: null, err: rateLimitResponse(rl.retryAfterSeconds) };

  return { user, err: null };
}

async function audit(admin, { userId, action, recordId, changes, req }) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    await admin.from("admin_audit_log").insert({
      user_id: userId,
      action,
      table_name: "shows_events",
      record_id: recordId || null,
      changes: changes || null,
      ip,
    });
  } catch {
    // audit failure is non-fatal — do not break the response
  }
}

export async function GET(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("shows_events")
    .select("id, name, location, event_date, event_time, price_cents, tickets_available, ticket_url, active, created_at")
    .order("event_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shows: data || [] });
}

export async function POST(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  const body = await req.json();
  const { name, location, event_date, event_time, venue_timezone, price_cents, tickets_available, active = true } = body;

  if (!name || !location || !event_date || !price_cents) {
    return NextResponse.json({ error: "name, location, event_date, and price_cents are required" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("shows_events")
    .insert({
      name, location, event_date,
      event_time: event_time || null,
      venue_timezone: venue_timezone || "America/Chicago",
      price_cents: Number(price_cents),
      tickets_available: tickets_available ?? null,
      active,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit(admin, { userId: user.id, action: "create", recordId: data.id, changes: { name, location, event_date, price_cents, active }, req });
  return NextResponse.json({ show: data });
}

export async function PATCH(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const allowed = ["name", "location", "event_date", "event_time", "venue_timezone", "price_cents", "tickets_available", "ticket_url", "active"];
  const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (update.price_cents !== undefined) update.price_cents = Number(update.price_cents);
  if (update.tickets_available !== undefined) update.tickets_available = update.tickets_available === "" ? null : Number(update.tickets_available);

  const admin = getAdminClient();
  const { data, error } = await admin.from("shows_events").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit(admin, { userId: user.id, action: "update", recordId: id, changes: update, req });
  return NextResponse.json({ show: data });
}

export async function DELETE(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const admin = getAdminClient();
  const { error } = await admin.from("shows_events").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit(admin, { userId: user.id, action: "deactivate", recordId: id, changes: { active: false }, req });
  return NextResponse.json({ ok: true });
}
