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

/**
 * Fan out a push notification to all enabled subscribers.
 * Automatically disables subscriptions that respond with 404/410 (expired).
 */
export async function sendPushToSubscribers(admin, payload) {
  if (!isWebPushConfigured()) {
    console.info("[web-push] VAPID not configured — skipping fan-out");
    return { sent: 0, failed: 0 };
  }

  const { data: subscriptions, error } = await admin
    .from("notification_push_subscriptions")
    .select("endpoint, p256dh, auth_secret, user_id")
    .eq("enabled", true);

  if (error || !subscriptions?.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const expired = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
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

  if (expired.length > 0) {
    await admin
      .from("notification_push_subscriptions")
      .update({ enabled: false })
      .in("endpoint", expired);
  }

  return { sent, failed };
}
