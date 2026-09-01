import {
  getActiveMembership,
  getCollectorAccessState,
  getVaultPassAccessState,
  isMissingSupabaseTable,
  membershipHasPremiumAccess,
} from "@/lib/commerce/entitlements";

export const SIGNAL_DURATION_MIN_MS = 3000;
export const SIGNAL_DURATION_MAX_MS = 10000;
export const SIGNAL_ACTIONS = new Set(["viewed", "completed", "ignored", "interacted", "loot_claimed"]);

export function isMissingSignalTable(error) {
  return isMissingSupabaseTable(error);
}

export function clampSignalDurationMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5200;
  return Math.min(SIGNAL_DURATION_MAX_MS, Math.max(SIGNAL_DURATION_MIN_MS, parsed));
}

function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinWindow({ startsAt, expiresAt }, nowMs) {
  const startMs = parseTime(startsAt);
  const endMs = parseTime(expiresAt);
  if (Number.isFinite(startMs) && nowMs < startMs) return false;
  if (Number.isFinite(endMs) && nowMs > endMs) return false;
  return true;
}

function audienceEligible(rules = {}, context = {}) {
  const scope = rules.scope || "all";
  if (scope === "all") return true;
  if (scope === "free") return !context.subscriber && !context.collector && !context.vault;
  if (scope === "subscriber") return Boolean(context.subscriber || context.innerCircle);
  if (scope === "collector") return Boolean(context.collector);
  if (scope === "vault") return Boolean(context.vault);

  const allowed = Array.isArray(rules.segments) ? rules.segments : [];
  if (allowed.includes("all")) return true;
  if (allowed.includes("free") && !context.subscriber && !context.collector && !context.vault) return true;
  if (allowed.includes("subscriber") && (context.subscriber || context.innerCircle)) return true;
  if (allowed.includes("collector") && context.collector) return true;
  if (allowed.includes("vault") && context.vault) return true;
  return false;
}

export async function getSignalAudienceContext(admin, userId) {
  const membership = await getActiveMembership(userId);
  const { data: libraryRows, error: libraryError } = await admin
    .from("library_items")
    .select("products(slug)")
    .eq("user_id", userId);

  if (libraryError) throw libraryError;

  const legacyOwnedSlugs = (libraryRows || []).map((row) => row.products?.slug).filter(Boolean);
  const [collectorAccess, vaultPassAccess] = await Promise.all([
    getCollectorAccessState(admin, userId, legacyOwnedSlugs),
    getVaultPassAccessState(admin, userId, legacyOwnedSlugs),
  ]);
  const subscriber = membershipHasPremiumAccess(membership);

  return {
    subscriber,
    collector: Boolean(collectorAccess.hasCollectorAccess),
    vault: Boolean(vaultPassAccess.hasVaultPass),
    innerCircle: Boolean(subscriber || collectorAccess.hasCollectorAccess),
  };
}

function resolveSignalDelivery(row, userState, audienceContext, nowMs) {
  const triggerMode = row.trigger_mode || "persistent";
  const lifecycleWindow = { startsAt: row.starts_at, expiresAt: row.expires_at };
  const liveWindow = {
    startsAt: row.live_starts_at || row.starts_at,
    expiresAt: row.live_expires_at || row.expires_at,
  };
  const hasResolved = Boolean(userState?.viewed_at || userState?.completed_at || userState?.ignored_at);
  const lifecycleActive = isWithinWindow(lifecycleWindow, nowMs);
  const liveWindowActive = isWithinWindow(liveWindow, nowMs);
  const eligibleAudience = audienceEligible(row.audience_rules || {}, audienceContext);
  const active = row.status === "active" && eligibleAudience;

  const deliverable = active && !hasResolved && (
    triggerMode === "live_window"
      ? liveWindowActive
      : lifecycleActive
  );

  return {
    active,
    deliverable,
    deliveryMode: triggerMode,
    durationMs: clampSignalDurationMs(row.duration_ms),
    liveWindowEligible: active && liveWindowActive && !userState?.loot_claimed_at,
    lifecycleWindow,
    liveWindow,
    state: userState || null,
  };
}

function normalizeSignalPayload(row, delivery) {
  const payload = row.payload || {};
  const content = payload.content || payload;
  const audio = payload.audio || {};
  const media = payload.media || {};
  const payloadTypes = Array.isArray(payload.payloadTypes)
    ? payload.payloadTypes
    : [
        "text",
        audio.audioAsset || content.audioAsset ? "audio" : null,
        media.videoAsset || media.mp4Asset || content.videoAsset || content.mp4 ? "video" : null,
      ].filter(Boolean);

  return {
    id: row.id,
    title: row.title,
    type: row.type,
    signalType: row.type,
    deliveryMode: row.trigger_mode,
    status: row.status,
    active: true,
    priority: row.priority || 0,
    durationMs: delivery.durationMs,
    payloadTypes,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    timezone: row.timezone,
    liveWindow: {
      startsAt: row.live_starts_at || row.starts_at,
      endsAt: row.live_expires_at || row.expires_at,
      allowLateCinematic: row.trigger_mode === "hybrid",
    },
    scheduled: row.timestamp_schedule || {},
    audience: row.audience_rules || { scope: "all" },
    unlockRules: row.unlock_rules || {},
    rewardRules: row.loot || {},
    loot: row.loot || {},
    tracking: {
      backend: true,
      lifecycleId: `${row.id}:${row.starts_at || "open"}:${row.expires_at || "open"}`,
      viewedState: "backend",
      interactionState: "backend",
    },
    animationProfile: payload.animationProfile || {
      style: "quiet-scan",
      motionSafe: true,
      fadeMs: 360,
      releaseMs: delivery.durationMs,
    },
    audio,
    media,
    payloads: payload.payloads || payload,
    content: {
      eyebrow: content.eyebrow || "2MRRW SIGNAL",
      title: content.title || row.title,
      text: content.text || content.message || "A signal crossed the platform.",
      detail: content.detail || "Normal transmission resumes now.",
      lyricFragment: content.lyricFragment || content.lyric_fragment || "",
      theme: content.theme || payload.theme || { accent: "#00ffff", secondaryAccent: "#8f7dff" },
      ...content,
    },
    delivery: {
      ...delivery,
      exclusiveInteraction: delivery.liveWindowEligible
        ? {
            unlockRules: row.unlock_rules || {},
            loot: row.loot || {},
          }
        : null,
    },
  };
}

export async function getDeliverableSignal(admin, userId, now = new Date()) {
  const nowMs = now.getTime();
  const audienceContext = await getSignalAudienceContext(admin, userId);
  const { data: signals, error } = await admin
    .from("signals")
    .select("*")
    .eq("status", "active")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) throw error;
  if (!signals?.length) return null;

  const signalIds = signals.map((signal) => signal.id);
  const { data: states, error: stateError } = await admin
    .from("signal_user_states")
    .select("*")
    .eq("user_id", userId)
    .in("signal_id", signalIds);

  if (stateError) throw stateError;

  const stateBySignal = new Map((states || []).map((state) => [state.signal_id, state]));
  for (const signal of signals) {
    const delivery = resolveSignalDelivery(signal, stateBySignal.get(signal.id), audienceContext, nowMs);
    if (delivery.deliverable) return normalizeSignalPayload(signal, delivery);
  }
  return null;
}

export async function recordSignalAction(admin, userId, { signalId, action, interactionDurationMs, metadata = {} }) {
  if (!SIGNAL_ACTIONS.has(action)) {
    const error = new Error("Unsupported signal action");
    error.status = 400;
    throw error;
  }

  const { data: signal, error: signalError } = await admin
    .from("signals")
    .select("*")
    .eq("id", signalId)
    .maybeSingle();

  if (signalError) throw signalError;
  if (!signal || signal.status !== "active") {
    const error = new Error("Signal is not active");
    error.status = 404;
    throw error;
  }

  const now = new Date();
  const delivery = resolveSignalDelivery(signal, null, await getSignalAudienceContext(admin, userId), now.getTime());
  const liveOnlyLoot = action === "loot_claimed" && !delivery.liveWindowEligible;
  const values = {
    user_id: userId,
    signal_id: signalId,
    metadata,
  };

  if (action === "viewed") values.viewed_at = now.toISOString();
  if (action === "completed") {
    values.completed_at = now.toISOString();
    values.interaction_duration_ms = Math.max(0, Number(interactionDurationMs) || 0);
  }
  if (action === "ignored") values.ignored_at = now.toISOString();
  if (action === "interacted") values.interaction_duration_ms = Math.max(0, Number(interactionDurationMs) || 0);
  if (action === "loot_claimed") {
    values.loot_claimed_at = liveOnlyLoot ? null : now.toISOString();
    values.loot_status = liveOnlyLoot ? "rejected" : "intent_recorded";
  }

  const { data, error } = await admin
    .from("signal_user_states")
    .upsert(values, { onConflict: "user_id,signal_id" })
    .select("*")
    .single();

  if (error) throw error;
  return { state: data, lootAccepted: action === "loot_claimed" && !liveOnlyLoot };
}
