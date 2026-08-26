import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";

function slugify(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
async function adminUser() { const user = await getAdminSessionUser(); return user && isAdminUser(user) ? user : null; }

export async function GET() {
  if (!await adminUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await getAdminClient().from("genre_taxonomy").select("id,parent_id,name,slug,description,sort_order,active").order("sort_order").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const roots = (data || []).filter((row) => !row.parent_id).map((row) => ({ ...row, subgenres: (data || []).filter((child) => child.parent_id === row.id) }));
  return NextResponse.json({ genres: roots });
}

export async function POST(req) {
  if (!await adminUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const { data, error } = await getAdminClient().from("genre_taxonomy").insert({ name, slug: slugify(body.slug || name), parent_id: body.parent_id || null, description: body.description || null, sort_order: Number(body.sort_order) || 0, active: body.active !== false }).select().single();
  return error ? NextResponse.json({ error: error.message }, { status: 409 }) : NextResponse.json({ genre: data }, { status: 201 });
}

export async function PATCH(req) {
  if (!await adminUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  const updates = {};
  for (const key of ["name","description","sort_order","active","parent_id"]) if (body[key] !== undefined) updates[key] = body[key];
  if (body.slug !== undefined || body.name !== undefined) updates.slug = slugify(body.slug || body.name);
  const { data, error } = await getAdminClient().from("genre_taxonomy").update(updates).eq("id", body.id).select().single();
  return error ? NextResponse.json({ error: error.message }, { status: 409 }) : NextResponse.json({ genre: data });
}

export async function DELETE(req) {
  if (!await adminUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  const { error } = await getAdminClient().from("genre_taxonomy").delete().eq("id", id);
  return error ? NextResponse.json({ error: "Genre is in use or has subgenres; disable it instead" }, { status: 409 }) : NextResponse.json({ ok: true });
}
