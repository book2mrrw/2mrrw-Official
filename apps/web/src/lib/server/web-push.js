import webpush from "web-push";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
}

export function getVapidPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export function isWebPushConfigured() {
  return Boolean(
    process.env.VAPID_SUBJECT &&
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  );
}

/**
 * Send a web push to one subscription.
 * Returns true on success, "expired" when the subscription is no longer valid, false on other errors.
 */
export async function sendWebPush(subscription, payload) {
  ensureInit();
  if (!isWebPushConfigured()) return false;

  const { endpoint, p256dh, auth_secret } = subscription;
  try {
    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth: auth_secret } },
      JSON.stringify(payload),
      { TTL: 86400 }
    );
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return "expired";
    console.warn("[web-push] send failed", err?.statusCode, err?.message?.slice(0, 120));
    return false;
  }
}

const PUSH_BATCH_SIZE = 100;
const PUSH_PAGE_SIZE = 500;

/**
 * Fan out a push notification to all enabled subscribers.
 * Paginates through all subscribers so no one is silently skipped.
 * Sends each page in batches of 100 to avoid overwhelming push services.
 * Automatically disables subscriptions that respond with 404/410 (expired).
 */
export async function sendPushToSubscribers(admin, payload, { eligibleUserIds = null } = {}) {
  if (!isWebPushConfigured()) {
    console.info("[web-push] VAPID not configured — skipping fan-out");
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const expired = [];
  let offset = 0;

  while (true) {
    const { data: page, error } = await admin
      .from("notification_push_subscriptions")
      .select("endpoint, p256dh, auth_secret, user_id")
      .eq("enabled", true)
      .range(offset, offset + PUSH_PAGE_SIZE - 1);

    if (error || !page?.length) break;

    const eligiblePage = eligibleUserIds === null
      ? page
      : page.filter((subscription) => eligibleUserIds.has(subscription.user_id));

    for (let i = 0; i < eligiblePage.length; i += PUSH_BATCH_SIZE) {
      const batch = eligiblePage.slice(i, i + PUSH_BATCH_SIZE);
      await Promise.all(
        batch.map(async (sub) => {
          const result = await sendWebPush(sub, payload);
          if (result === true) {
            sent++;
          } else if (result === "expired") {
            expired.push(sub.endpoint);
            failed++;
          } else {
            failed++;
          }
        })
      );
    }

    offset += page.length;
    if (page.length < PUSH_PAGE_SIZE) break;
  }

  if (expired.length > 0) {
    await admin
      .from("notification_push_subscriptions")
      .update({ enabled: false })
      .in("endpoint", expired);
  }

  return { sent, failed };
}
