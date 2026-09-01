export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPushPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function fetchVapidKey() {
  const res = await fetch("/api/notifications/vapid-key");
  if (!res.ok) throw new Error("Push not configured");
  const { publicKey } = await res.json();
  return publicKey;
}

/**
 * Request permission, subscribe, and register with the server.
 * Returns: "subscribed" | "denied" | "unsupported" | "already_subscribed" | "error"
 */
export async function enablePushNotifications() {
  if (!isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const publicKey = await fetchVapidKey();
    const registration = await navigator.serviceWorker.ready;

    // If already subscribed with the same key, re-register to ensure server has it.
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: existing.toJSON() }),
      });
      return "already_subscribed";
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });

    return "subscribed";
  } catch (err) {
    console.warn("[push] subscribe error", err?.message);
    return "error";
  }
}

/**
 * Unsubscribe from push and deregister from server.
 */
export async function disablePushNotifications() {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await fetch("/api/notifications/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch (err) {
    console.warn("[push] unsubscribe error", err?.message);
  }
}

/**
 * Returns the current push subscription object, or null if not subscribed.
 */
export async function getCurrentPushSubscription() {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}
