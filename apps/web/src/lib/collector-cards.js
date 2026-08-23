import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable, isSchemaUnavailableError } from "@/lib/commerce/entitlements";
import { grantEntitlementFlag } from "@/lib/entitlements";

const ACTIVE_COLLECTOR_STATUSES = new Set(["collector", "verified_collector", "founder_collector", "vault_collector"]);

export function normalizeCollectorSecret(value) {
  return String(value || "").trim();
}

export function hashCollectorSecret(value) {
  const normalized = normalizeCollectorSecret(value);
  if (!normalized || normalized.length < 16) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function hashIpAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return crypto.createHmac("sha256", process.env.COLLECTOR_IP_HASH_SECRET || process.env.GUEST_SESSION_SECRET || "collector-ip").update(raw).digest("hex");
}

export function requestDeviceInfo(req) {
  return {
    userAgent: req.headers.get("user-agent") || null,
    acceptLanguage: req.headers.get("accept-language") || null,
    platform: req.headers.get("sec-ch-ua-platform") || null,
    mobile: req.headers.get("sec-ch-ua-mobile") || null,
  };
}

export function requestIpHash(req) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0] || req.headers.get("x-real-ip") || "";
  return hashIpAddress(ip);
}

function collectorStatusForTier(tier) {
  if (tier === "founder_collector" || tier === "artist_proof") return "founder_collector";
  if (tier === "vault_collector") return "vault_collector";
  if (tier === "collector") return "collector";
  return "verified_collector";
}

function cardReleaseTitle(card = {}) {
  return card.release_title || card.release_name || null;
}

function cardAccessTier(card = {}) {
  return card.access_tier || card.collector_tier || "collector";
}

function cardVerificationStatus(card = {}) {
  return card.verification_status || card.status || null;
}

async function logCollectorActivity(admin, event) {
  const { error } = await admin.from("collector_activity_logs").insert(event);
  if (error && !isMissingSupabaseTable(error)) {
    console.warn("collector activity log failed:", error.message);
  }
}

async function grantCollectorAccess(admin, { userId, card }) {
  const accessTier = cardAccessTier(card);
  const collectorStatus = collectorStatusForTier(accessTier);
  const perks = {
    source: "collector_card_claim",
    releaseName: cardReleaseTitle(card),
    visibleSerial: card.visible_serial,
    accessTier,
    collectorTier: accessTier,
    streamingAccess: true,
    vaultAccess: true,
    livestreamAccess: true,
    futurePrivileges: true,
  };

  const { data, error } = await admin
    .from("collector_access")
    .upsert({
      user_id: userId,
      collector_card_id: card.id,
      streaming_access: true,
      vault_access: true,
      livestream_access: true,
      collector_status: collectorStatus,
      perks_json: perks,
      revoked_at: null,
    }, { onConflict: "user_id,collector_card_id" })
    .select("*, collector_cards (visible_serial, release_title, access_tier, verification_status)")
    .single();

  if (error) {
    if (isSchemaUnavailableError(error)) return null;
    throw error;
  }
  return data;
}

async function mirrorCollectorOwnership(admin, { userId, card }) {
  if (!card.product_slug) return null;

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, slug, title, product_type, metadata")
    .eq("slug", card.product_slug)
    .maybeSingle();

  if (productError) throw productError;
  if (!product?.id) return null;

  const { data, error } = await admin
    .from("collector_ownerships")
    .upsert({
      user_id: userId,
      product_id: product.id,
      product_slug: product.slug,
      title: product.title || cardReleaseTitle(card),
      collector_type: "collector_card",
      sku: card.visible_serial,
      version: cardAccessTier(card),
      payment_status: "completed",
      verification_status: "verified",
      entitlement_status: "active",
      metadata: {
        source: "collector_card_claim",
        collector_card_id: card.id,
        visible_serial: card.visible_serial,
      },
      verified_at: new Date().toISOString(),
    }, { onConflict: "user_id,product_id" })
    .select("*")
    .maybeSingle();

  if (error && !isMissingSupabaseTable(error)) throw error;
  return data || null;
}

export function mapCollectorAccessRecord(row = {}) {
  const card = row.collector_cards || row.collector_card || {};
  return {
    id: row.id,
    collectorCardId: row.collector_card_id,
    visibleSerial: card.visible_serial || row.visible_serial || null,
    releaseName: cardReleaseTitle(card) || row.release_title || row.release_name || null,
    accessTier: cardAccessTier(card),
    collectorTier: cardAccessTier(card),
    cardStatus: cardVerificationStatus(card),
    collectorStatus: row.collector_status,
    streamingAccess: Boolean(row.streaming_access),
    vaultAccess: Boolean(row.vault_access),
    livestreamAccess: Boolean(row.livestream_access),
    perks: row.perks_json || {},
    updatedAt: row.updated_at,
  };
}

export async function getCollectorAccessRecords(admin, userId) {
  const embeddedSelect =
    "id, collector_card_id, streaming_access, vault_access, livestream_access, collector_status, perks_json, updated_at, revoked_at, collector_cards (visible_serial, release_title, access_tier, verification_status)";
  const plainSelect =
    "id, collector_card_id, streaming_access, vault_access, livestream_access, collector_status, perks_json, updated_at, revoked_at";

  let { data, error } = await admin
    .from("collector_access")
    .select(embeddedSelect)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isMissingSupabaseTable(error) || isSchemaUnavailableError(error)) {
      const fallback = await admin
        .from("collector_access")
        .select(plainSelect)
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("updated_at", { ascending: false });
      if (fallback.error) {
        if (isMissingSupabaseTable(fallback.error) || isSchemaUnavailableError(fallback.error)) return [];
        throw fallback.error;
      }
      data = fallback.data;
    } else {
      throw error;
    }
  }

  return (data || []).filter((row) => ACTIVE_COLLECTOR_STATUSES.has(row.collector_status)).map(mapCollectorAccessRecord);
}

export async function claimCollectorCard({ userId, token, deviceInfo = {}, ipHash = null }) {
  const hiddenSecureId = hashCollectorSecret(token);
  if (!hiddenSecureId) {
    return { ok: false, status: 400, reason: "invalid_token" };
  }

  const admin = getAdminClient();
  const { data: card, error } = await admin
    .from("collector_cards")
    .select("*")
    .eq("hidden_secure_id", hiddenSecureId)
    .maybeSingle();

  if (error) {
    if (isSchemaUnavailableError(error)) {
      return { ok: false, status: 503, reason: "unavailable" };
    }
    throw error;
  }

  if (!card) {
    await logCollectorActivity(admin, {
      user_id: userId,
      event_type: "verification_attempt",
      status: "blocked",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { reason: "not_found" },
    });
    return { ok: false, status: 404, reason: "not_found" };
  }

  if (cardVerificationStatus(card) === "revoked" || card.revoked_at) {
    await logCollectorActivity(admin, {
      collector_card_id: card.id,
      user_id: userId,
      event_type: "verification_attempt",
      status: "blocked",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { reason: "revoked" },
    });
    return { ok: false, status: 403, reason: "revoked", visibleSerial: card.visible_serial };
  }

  if (card.claimed && card.claimed_by_user_id && card.claimed_by_user_id !== userId) {
    await logCollectorActivity(admin, {
      collector_card_id: card.id,
      user_id: userId,
      event_type: "duplicate_scan",
      status: "flagged",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { reason: "claimed_by_other_account" },
    });
    await admin.from("collector_claims").insert({
      collector_card_id: card.id,
      user_id: userId,
      device_info: deviceInfo,
      ip_hash: ipHash,
      status: "duplicate",
      metadata: { reason: "claimed_by_other_account" },
    });
    return { ok: false, status: 409, reason: "already_claimed", visibleSerial: card.visible_serial };
  }

  let claimedCard = card;
  if (!card.claimed) {
    const { data: updated, error: updateError } = await admin
      .from("collector_cards")
      .update({
        claimed: true,
        claimed_by_user_id: userId,
        verification_status: "claimed",
        claim_timestamp: new Date().toISOString(),
      })
      .eq("id", card.id)
      .eq("claimed", false)
      .select("*")
      .maybeSingle();

    if (updateError) {
      if (isSchemaUnavailableError(updateError)) {
        return { ok: false, status: 503, reason: "unavailable" };
      }
      throw updateError;
    }
    if (!updated) {
      return { ok: false, status: 409, reason: "claim_race" };
    }
    claimedCard = updated;
  }

  const [access] = await Promise.all([
    grantCollectorAccess(admin, { userId, card: claimedCard }),
    mirrorCollectorOwnership(admin, { userId, card: claimedCard }),
    grantEntitlementFlag(admin, userId, "collector_card", "nfc_claim", {
      collector_card_id: claimedCard.id,
    }),
    grantEntitlementFlag(admin, userId, "vault_access", "collector_card", {
      metadata: { collector_card_id: claimedCard.id },
    }),
    admin.from("collector_cards").update({ digital_access_granted: true }).eq("id", claimedCard.id),
    admin.from("collector_claims").insert({
      collector_card_id: claimedCard.id,
      user_id: userId,
      device_info: deviceInfo,
      ip_hash: ipHash,
      status: card.claimed ? "duplicate" : "claimed",
      metadata: { reason: card.claimed ? "already_owned_by_user" : "first_claim" },
    }),
    logCollectorActivity(admin, {
      collector_card_id: claimedCard.id,
      user_id: userId,
      event_type: card.claimed ? "scan" : "claim",
      status: "allowed",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { visibleSerial: claimedCard.visible_serial },
    }),
    logCollectorActivity(admin, {
      collector_card_id: claimedCard.id,
      user_id: userId,
      event_type: "access_grant",
      status: "allowed",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { streaming: true, vault: true, livestream: true },
    }),
  ]);

  return {
    ok: true,
    status: 200,
    card: {
      visibleSerial: claimedCard.visible_serial,
      releaseName: cardReleaseTitle(claimedCard),
      accessTier: cardAccessTier(claimedCard),
      collectorTier: cardAccessTier(claimedCard),
      status: cardVerificationStatus(claimedCard),
    },
    access: access ? mapCollectorAccessRecord(access) : null,
  };
}

function assignedUserIdFromCard(card = {}) {
  const meta = card.metadata || {};
  return meta.assigned_user_id || meta.preassigned_user_id || meta.assignedUserId || null;
}

function normalizeVisibleSerial(value) {
  return String(value || "").trim();
}

/**
 * Manual activation by visible serial + legal name (authenticated user required).
 * NFC/hidden token verify remains at /api/collector-card/verify; claim via hidden token at /api/collector/cards/claim.
 */
export async function activateCollectorCardBySerial({
  userId,
  visibleSerial,
  legalName,
  deviceInfo = {},
  ipHash = null,
}) {
  const serial = normalizeVisibleSerial(visibleSerial);
  const name = String(legalName || "").trim();
  if (!userId) return { ok: false, status: 401, reason: "auth_required" };
  if (!serial || serial.length < 4) return { ok: false, status: 400, reason: "invalid_serial" };
  if (!name || name.length < 2) return { ok: false, status: 400, reason: "legal_name_required" };

  const admin = getAdminClient();
  const { data: card, error } = await admin
    .from("collector_cards")
    .select("*")
    .eq("visible_serial", serial)
    .maybeSingle();

  if (error) {
    if (isSchemaUnavailableError(error)) return { ok: false, status: 503, reason: "unavailable" };
    throw error;
  }

  if (!card) {
    await logCollectorActivity(admin, {
      user_id: userId,
      event_type: "activation_attempt",
      status: "blocked",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { reason: "not_found", visibleSerial: serial },
    });
    return { ok: false, status: 404, reason: "not_found" };
  }

  if (cardVerificationStatus(card) === "revoked" || card.revoked_at) {
    return { ok: false, status: 403, reason: "revoked", visibleSerial: card.visible_serial };
  }

  const assignedUserId = assignedUserIdFromCard(card);
  if (assignedUserId && assignedUserId !== userId && !card.claimed) {
    return { ok: false, status: 403, reason: "assigned_to_other", visibleSerial: card.visible_serial };
  }

  if (card.claimed && card.claimed_by_user_id && card.claimed_by_user_id !== userId) {
    if (assignedUserId !== userId) {
      return { ok: false, status: 409, reason: "already_claimed", visibleSerial: card.visible_serial };
    }
  }

  if (card.claimed && card.claimed_by_user_id === userId) {
    await admin
      .from("profiles")
      .update({ legal_name: name, updated_at: new Date().toISOString() })
      .eq("id", userId);
    const access = await grantCollectorAccess(admin, { userId, card });
    await grantEntitlementFlag(admin, userId, "collector_card", "serial_activation", {
      collector_card_id: card.id,
    });
    return {
      ok: true,
      status: 200,
      alreadyActive: true,
      card: {
        visibleSerial: card.visible_serial,
        releaseName: cardReleaseTitle(card),
        accessTier: cardAccessTier(card),
      },
      access: access ? mapCollectorAccessRecord(access) : null,
    };
  }

  const { data: updated, error: updateError } = await admin
    .from("collector_cards")
    .update({
      claimed: true,
      claimed_by_user_id: userId,
      verification_status: "claimed",
      claim_timestamp: new Date().toISOString(),
      digital_access_granted: true,
    })
    .eq("id", card.id)
    .eq("claimed", false)
    .select("*")
    .maybeSingle();

  if (updateError) {
    if (isSchemaUnavailableError(updateError)) return { ok: false, status: 503, reason: "unavailable" };
    throw updateError;
  }

  if (!updated) {
    const { data: refreshed } = await admin.from("collector_cards").select("*").eq("id", card.id).maybeSingle();
    if (refreshed?.claimed_by_user_id === userId) {
      await admin
        .from("profiles")
        .update({ legal_name: name, updated_at: new Date().toISOString() })
        .eq("id", userId);
      const access = await grantCollectorAccess(admin, { userId, card: refreshed });
      await grantEntitlementFlag(admin, userId, "collector_card", "serial_activation", {
        collector_card_id: refreshed.id,
      });
      return {
        ok: true,
        status: 200,
        alreadyActive: true,
        card: {
          visibleSerial: refreshed.visible_serial,
          releaseName: cardReleaseTitle(refreshed),
          accessTier: cardAccessTier(refreshed),
        },
        access: access ? mapCollectorAccessRecord(access) : null,
      };
    }
    return { ok: false, status: 409, reason: "claim_race", visibleSerial: card.visible_serial };
  }

  await admin
    .from("profiles")
    .update({ legal_name: name, updated_at: new Date().toISOString() })
    .eq("id", userId);

  const [access] = await Promise.all([
    grantCollectorAccess(admin, { userId, card: updated }),
    mirrorCollectorOwnership(admin, { userId, card: updated }),
    grantEntitlementFlag(admin, userId, "collector_card", "serial_activation", {
      collector_card_id: updated.id,
    }),
    grantEntitlementFlag(admin, userId, "vault_access", "collector_card", {
      metadata: { collector_card_id: updated.id },
    }),
    admin.from("collector_claims").insert({
      collector_card_id: updated.id,
      user_id: userId,
      device_info: deviceInfo,
      ip_hash: ipHash,
      status: "claimed",
      metadata: { method: "visible_serial_activation", visibleSerial: serial },
    }),
    logCollectorActivity(admin, {
      collector_card_id: updated.id,
      user_id: userId,
      event_type: "activation",
      status: "allowed",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { visibleSerial: serial },
    }),
  ]);

  return {
    ok: true,
    status: 200,
    card: {
      visibleSerial: updated.visible_serial,
      releaseName: cardReleaseTitle(updated),
      accessTier: cardAccessTier(updated),
    },
    access: access ? mapCollectorAccessRecord(access) : null,
  };
}

export async function verifyCollectorCardToken({ token, userId = null, deviceInfo = {}, ipHash = null }) {
  const hiddenSecureId = hashCollectorSecret(token);
  if (!hiddenSecureId) {
    return { ok: false, status: 400, reason: "invalid_token" };
  }

  const admin = getAdminClient();
  const { data: card, error } = await admin
    .from("collector_cards")
    .select("id, visible_serial, release_title, access_tier, claimed, claimed_by_user_id, verification_status, revoked_at")
    .eq("hidden_secure_id", hiddenSecureId)
    .maybeSingle();

  if (error) {
    if (isSchemaUnavailableError(error)) {
      return { ok: false, status: 503, reason: "unavailable" };
    }
    throw error;
  }

  if (!card || cardVerificationStatus(card) === "revoked" || card.revoked_at) {
    await logCollectorActivity(admin, {
      user_id: userId,
      event_type: "verification_attempt",
      status: "blocked",
      device_info: deviceInfo,
      ip_hash: ipHash,
      metadata: { reason: card ? "revoked" : "not_found" },
    });
    return { ok: false, status: card ? 403 : 404, reason: card ? "revoked" : "not_found" };
  }

  await logCollectorActivity(admin, {
    collector_card_id: card.id,
    user_id: userId,
    event_type: "scan",
    status: "recorded",
    device_info: deviceInfo,
    ip_hash: ipHash,
    metadata: { claimed: card.claimed },
  });

  return {
    ok: true,
    status: 200,
    card: {
      visibleSerial: card.visible_serial,
      releaseName: cardReleaseTitle(card),
      accessTier: cardAccessTier(card),
      collectorTier: cardAccessTier(card),
      claimed: Boolean(card.claimed),
      ownedByCurrentUser: Boolean(userId && card.claimed_by_user_id === userId),
      status: cardVerificationStatus(card),
    },
  };
}
