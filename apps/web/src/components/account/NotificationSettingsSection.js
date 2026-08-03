"use client";
import { useState, useEffect, useCallback } from "react";
import NotificationCenterPanel from "./NotificationCenterPanel";
import {
  isPushSupported,
  getPushPermission,
  enablePushNotifications,
  disablePushNotifications,
} from "@/lib/push-notifications";

const NOTIFICATION_TOGGLES = [
  {
    key: "webPushEnabled",
    label: "Browser Notifications",
    detail: "Alerts on this device, even when the tab is closed",
  },
  {
    key: "emailEnabled",
    label: "Email",
    detail: "Release drops and updates to your inbox",
  },
  {
    key: "releaseAlerts",
    label: "New Releases",
    detail: "Drops, singles, albums, and exclusive content",
  },
  {
    key: "vaultAlerts",
    label: "Vault Drops",
    detail: "Limited and exclusive vault content",
  },
  {
    key: "livestreamAlerts",
    label: "Live Events",
    detail: "Livestream and show announcements",
  },
  {
    key: "collectorAlerts",
    label: "Collector Updates",
    detail: "Card activations and collector news",
  },
  {
    key: "communityReplyAlerts",
    label: "Circle Replies",
    detail: "When someone replies to your posts",
  },
];

const DEFAULT_PREFS = {
  webPushEnabled: false,
  emailEnabled: true,
  releaseAlerts: true,
  vaultAlerts: true,
  livestreamAlerts: true,
  collectorAlerts: true,
  communityReplyAlerts: true,
};

const DEFAULT_SUMMARY = { unreadCount: 0, latest: [] };

export default function NotificationSettingsSection({ isMobile }) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [pushDenied, setPushDenied] = useState(false);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        if (data.preferences) setPreferences((p) => ({ ...p, ...data.preferences }));
        if (data.summary) setSummary(data.summary);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const patchPreferences = useCallback(async (updates) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: updates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      if (data.preferences) setPreferences((p) => ({ ...p, ...data.preferences }));
    } catch (err) {
      setError(err.message || "Could not save preference");
    } finally {
      setSaving(false);
    }
  }, []);

  const updateNotificationPreference = useCallback(async (key, value) => {
    // Web push toggle requires browser permission + subscription flow.
    if (key === "webPushEnabled") {
      if (!isPushSupported()) {
        setError("Your browser doesn’t support push notifications.");
        return;
      }
      if (value) {
        const permission = getPushPermission();
        if (permission === "denied") {
          setPushDenied(true);
          setError("Notifications are blocked in your browser. Open browser settings to allow them for this site.");
          return;
        }
        setSaving(true);
        setError(null);
        const result = await enablePushNotifications();
        setSaving(false);
        if (result === "denied") {
          setPushDenied(true);
          setError("Notification permission denied. You can change this in your browser settings.");
          return;
        }
        if (result === "error") {
          setError("Could not set up push notifications. Try again.");
          return;
        }
        // "subscribed" or "already_subscribed" — now save the preference
        setPreferences((p) => ({ ...p, webPushEnabled: true }));
        await patchPreferences({ webPushEnabled: true });
      } else {
        setPreferences((p) => ({ ...p, webPushEnabled: false }));
        await Promise.all([
          disablePushNotifications(),
          patchPreferences({ webPushEnabled: false }),
        ]);
      }
      return;
    }

    // All other toggles: optimistic UI + PATCH
    setPreferences((p) => ({ ...p, [key]: value }));
    await patchPreferences({ [key]: value });
  }, [patchPreferences]);

  const markNotificationsRead = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read" }),
      });
      setSummary((s) => ({ ...s, unreadCount: 0 }));
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  }, []);

  // Filter out web push toggle if browser doesn't support it
  const visibleToggles = isPushSupported()
    ? NOTIFICATION_TOGGLES
    : NOTIFICATION_TOGGLES.filter((t) => t.key !== "webPushEnabled");

  if (!loaded) return null;

  return (
    <NotificationCenterPanel
      isMobile={isMobile}
      notificationSummary={summary}
      notificationToggles={visibleToggles}
      notificationPreferences={preferences}
      notificationSaving={saving}
      notificationError={pushDenied
        ? error
        : error
      }
      markNotificationsRead={markNotificationsRead}
      updateNotificationPreference={updateNotificationPreference}
    />
  );
}
