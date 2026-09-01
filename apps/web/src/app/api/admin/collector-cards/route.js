import { NextResponse } from "next/server";
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import {
  grantEntitlementFlag,
  revokeAllUserEntitlements,
  revokeEntitlementFlag,
} from "@/lib/entitlements";
import { hashCollectorSecret } from "@/lib/collector-cards";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";

async function requireAdmin() {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return { error: NextResponse.json({ error: "Admin account required" }, { status: 403 }) };
  }
  return { user, admin: getAdminClient() };
}

export async function GET(req) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") || 50), 200);

    const { data, error } = await auth.admin
      .from("event_checkins")
      .select("id, user_id, collector_card_id, event_name, checkin_method, status, checked_in_at, metadata")
      .order("checked_in_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ checkins: data || [] });
  } catch (err) {
    console.error("[admin-collector-cards] GET error:", err);
    return NextResponse.json({ error: err.message || "Failed to load check-ins" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const rl = await checkRateLimit(req, {
      routeKey: "admin.collector-cards",
      limit: 10,
      windowSeconds: 60,
      identifier: auth.user.id,
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

    const body = await req.json();
    const action = body.action;

    switch (action) {
      case "import_serials":
        return importSerials(auth.admin, body);
      case "gift_vault":
        return giftVault(auth.admin, body);
      case "grant_subscriber":
        return grantSubscriber(auth.admin, body);
      case "grant_collector":
        return grantCollector(auth.admin, body);
      case "revoke":
        return revokeUser(auth.admin, body);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[admin-collector-cards] POST error:", err);
    return NextResponse.json({ error: err.message || "Admin action failed" }, { status: 500 });
  }
}

async function importSerials(admin, body) {
  const cards = body.cards || body.serials || [];
  if (!Array.isArray(cards) || !cards.length) {
    return NextResponse.json({ error: "cards array required" }, { status: 400 });
  }

  const rows = cards.map((card) => {
    const secret = String(card.hiddenSecureId || card.secret || card.token || "").trim();
    const hiddenSecureId = secret.length === 64 && /^[a-f0-9]+$/.test(secret)
      ? secret
      : hashCollectorSecret(secret) || crypto.createHash("sha256").update(secret).digest("hex");

    return {
      release_title: card.releaseTitle || card.release_title || "2MRRW Collector Card",
      visible_serial: card.visibleSerial || card.visible_serial || card.serial,
      hidden_secure_id: hiddenSecureId,
      edition_size: Number(card.editionSize || card.edition_size || 500),
      product_slug: card.productSlug || card.product_slug || null,
      access_tier: card.accessTier || card.access_tier || "collector",
      verification_status: "minted",
      nfc_enabled: card.nfcEnabled !== false,
      digital_access_granted: false,
      metadata: card.metadata || {},
    };
  }).filter((row) => row.visible_serial && row.hidden_secure_id);

  if (!rows.length) {
    return NextResponse.json({ error: "No valid card rows" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("collector_cards")
    .upsert(rows, { onConflict: "visible_serial", ignoreDuplicates: false })
    .select("id, visible_serial, release_title, product_slug");

  if (error) throw error;
  console.log("[admin-collector-cards] imported", data?.length);
  return NextResponse.json({ imported: data?.length || 0, cards: data || [] });
}

async function giftVault(admin, body) {
  const userId = body.userId;
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  await grantEntitlementFlag(admin, userId, "vault_access", "admin_gift_vault", {
    metadata: { note: body.note || null },
  });
  invalidateAccountStateCache(userId).catch(() => {});
  return NextResponse.json({ ok: true, userId, granted: "vault_access" });
}

async function grantSubscriber(admin, body) {
  const userId = body.userId;
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const { data: existing } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    user_id: userId,
    tier: body.tier || "inner_circle",
    status: "active",
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await admin.from("memberships").update(row).eq("id", existing.id);
  } else {
    await admin.from("memberships").insert(row);
  }

  await grantEntitlementFlag(admin, userId, "subscriber", "admin_grant");
  invalidateAccountStateCache(userId).catch(() => {});
  return NextResponse.json({ ok: true, userId, granted: "subscriber" });
}

async function grantCollector(admin, body) {
  const userId = body.userId;
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  await grantEntitlementFlag(admin, userId, "collector_card", "admin_grant", {
    collector_card_id: body.collectorCardId || null,
  });
  invalidateAccountStateCache(userId).catch(() => {});
  return NextResponse.json({ ok: true, userId, granted: "collector_card" });
}

async function revokeUser(admin, body) {
  const userId = body.userId;
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const type = body.entitlementType;
  if (type && ["vault_access", "subscriber", "collector_card"].includes(type)) {
    await revokeEntitlementFlag(admin, userId, type);
    invalidateAccountStateCache(userId).catch(() => {});
    return NextResponse.json({ ok: true, userId, revoked: type });
  }

  await revokeAllUserEntitlements(admin, userId, body.reason || "admin_revoke");
  invalidateAccountStateCache(userId).catch(() => {});
  return NextResponse.json({ ok: true, userId, revoked: "all" });
}
