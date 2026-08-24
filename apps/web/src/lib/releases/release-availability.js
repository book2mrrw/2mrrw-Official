const LIVE_STATUSES = new Set(["published", "live"]);
const UNAVAILABLE_STATUSES = new Set(["archived", "unavailable", "withdrawn"]);

function instant(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function releaseAvailability(release, context = {}, now = new Date()) {
  const nowMs = instant(now) ?? Date.now();
  const availableMs = instant(release?.available_at || release?.scheduled_at);
  const preorderMs = instant(release?.preorder_starts_at);
  const earlyMs = instant(release?.early_access_starts_at);
  const unavailableMs = instant(release?.unavailable_at);
  const status = String(release?.status || "draft").toLowerCase();
  const admin = Boolean(context.admin);
  const owned = Boolean(context.owned);
  const preorderOwned = Boolean(context.preorderOwned);
  const releasable = status === "scheduled" || LIVE_STATUSES.has(status);
  const due = releasable && availableMs != null && availableMs <= nowMs;
  const unavailable = UNAVAILABLE_STATUSES.has(status) || (unavailableMs != null && unavailableMs <= nowMs);
  const live = !unavailable && (due || (LIVE_STATUSES.has(status) && availableMs == null));
  const visible = admin || (!unavailable && (live || Boolean(release?.upcoming_visible || release?.storefront_visible)));
  const preorderOpen = releasable && !live && !unavailable && Boolean(release?.preorder_enabled)
    && (preorderMs == null || preorderMs <= nowMs);
  const audiences = Array.isArray(release?.early_access_audiences)
    ? release.early_access_audiences
    : ["preorder_purchasers"];
  const earlyWindow = releasable && !live && !unavailable && Boolean(release?.early_access_enabled)
    && earlyMs != null && earlyMs <= nowMs;
  const earlyEligible = earlyWindow && (
    (preorderOwned && audiences.includes("preorder_purchasers"))
    || (Boolean(context.subscriber) && audiences.includes("subscribers"))
    || (Boolean(context.collector) && audiences.includes("collectors"))
  );
  const canPlayFull = admin || live ? Boolean(admin || context.normallyEntitled) : earlyEligible;

  let phase = "draft";
  if (unavailable) phase = "unavailable";
  else if (live) phase = "live";
  else if (earlyWindow) phase = "early_access";
  else if (preorderOpen) phase = "preorder";
  else if (status === "scheduled" || availableMs != null) phase = "upcoming";

  return {
    phase,
    visible,
    live,
    preorderOpen,
    earlyEligible,
    canPurchase: visible && (live || preorderOpen) && !owned,
    canPlayFull,
    canPreview: visible && !canPlayFull && (live || Boolean(release?.preview_before_release)),
    availableAt: availableMs == null ? null : new Date(availableMs).toISOString(),
    earlyAccessAt: earlyMs == null ? null : new Date(earlyMs).toISOString(),
    earlyAccessEnabled: Boolean(release?.early_access_enabled),
    preorderPriceCents: preorderOpen && release?.preorder_price_cents != null
      ? Number(release.preorder_price_cents)
      : null,
    scope: release?.early_access_scope || { mode: "full_release", track_ids: [] },
  };
}

export function validateLifecycleConfiguration(release, now = new Date()) {
  const errors = [];
  const availableMs = instant(release?.available_at || release?.scheduled_at);
  const preorderMs = instant(release?.preorder_starts_at);
  const earlyMs = instant(release?.early_access_starts_at);
  if (release?.status === "scheduled" && availableMs == null) errors.push("A valid future release time is required");
  if (release?.status === "scheduled" && availableMs != null && availableMs <= instant(now)) errors.push("Scheduled release time must be in the future");
  if (release?.preorder_enabled && preorderMs == null) errors.push("Pre-order start time is required");
  if (release?.preorder_enabled && (!Number.isFinite(Number(release?.preorder_price_cents)) || Number(release.preorder_price_cents) < 0)) errors.push("A valid pre-order price is required");
  if (release?.preorder_enabled && preorderMs != null && availableMs != null && preorderMs > availableMs) errors.push("Pre-order must start before release");
  if (release?.early_access_enabled && !release?.preorder_enabled) errors.push("Early access requires pre-order");
  if (release?.early_access_enabled && earlyMs == null) errors.push("Early-access time is required");
  if (earlyMs != null && availableMs != null && earlyMs > availableMs) errors.push("Early access must start before release");
  if (release?.release_timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: release.release_timezone }).format(now); }
    catch { errors.push("A valid IANA timezone is required"); }
  }
  return errors;
}
