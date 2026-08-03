export const DEFAULT_NOTIFICATION_PREFERENCES = {
  inAppEnabled: true,
  emailEnabled: true,
  smsEnabled: false,
  webPushEnabled: false,
  mobilePushEnabled: false,
  releaseAlerts: true,
  livestreamAlerts: true,
  collectorAlerts: true,
  vaultAlerts: true,
  audioDiaryAlerts: true,
  communityReplyAlerts: true,
  premiumUnlockAlerts: true,
  subscriberAlerts: true,
  visibility: "full",
};

const PREFERENCE_COLUMNS = {
  inAppEnabled: "in_app_enabled",
  emailEnabled: "email_enabled",
  smsEnabled: "sms_enabled",
  webPushEnabled: "web_push_enabled",
  mobilePushEnabled: "mobile_push_enabled",
  releaseAlerts: "release_alerts",
  livestreamAlerts: "livestream_alerts",
  collectorAlerts: "collector_alerts",
  vaultAlerts: "vault_alerts",
  audioDiaryAlerts: "audio_diary_alerts",
  communityReplyAlerts: "community_reply_alerts",
  premiumUnlockAlerts: "premium_unlock_alerts",
  subscriberAlerts: "subscriber_alerts",
  visibility: "visibility",
};

const TOPIC_PREFS = {
  community_reply: "communityReplyAlerts",
  release: "releaseAlerts",
  livestream: "livestreamAlerts",
  collector: "collectorAlerts",
  vault: "vaultAlerts",
  audio_diary: "audioDiaryAlerts",
  premium_unlock: "premiumUnlockAlerts",
  subscriber: "subscriberAlerts",
};

export function isMissingNotificationsTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return error?.code === "42P01" || message.includes("notification_") && message.includes("does not exist");
}

function mapPreferenceRow(row) {
  if (!row) return DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    inAppEnabled: row.in_app_enabled ?? true,
    emailEnabled: row.email_enabled ?? true,
    smsEnabled: row.sms_enabled ?? false,
    webPushEnabled: row.web_push_enabled ?? false,
    mobilePushEnabled: row.mobile_push_enabled ?? false,
    releaseAlerts: row.release_alerts ?? true,
    livestreamAlerts: row.livestream_alerts ?? true,
    collectorAlerts: row.collector_alerts ?? true,
    vaultAlerts: row.vault_alerts ?? true,
    audioDiaryAlerts: row.audio_diary_alerts ?? true,
    communityReplyAlerts: row.community_reply_alerts ?? true,
    premiumUnlockAlerts: row.premium_unlock_alerts ?? true,
    subscriberAlerts: row.subscriber_alerts ?? true,
    visibility: row.visibility || "full",
  };
}

export function normalizeNotificationPreferences(input = {}) {
  return Object.entries(PREFERENCE_COLUMNS).reduce((acc, [key, column]) => {
    if (input[key] === undefined) return acc;
    acc[column] = key === "visibility" ? String(input[key] || "full") : Boolean(input[key]);
    return acc;
  }, {});
}

export async function ensureNotificationPreferences(admin, userId, overrides = {}) {
  const values = {
    user_id: userId,
    ...normalizeNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...overrides }),
  };

  const { data, error } = await admin
    .from("notification_preferences")
    .upsert(values, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    if (isMissingNotificationsTable(error)) return DEFAULT_NOTIFICATION_PREFERENCES;
    throw error;
  }

  return mapPreferenceRow(data);
}

export async function getNotificationState(admin, userId) {
  const [preferencesResult, inboxResult, unreadCountResult] = await Promise.all([
    admin.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("notification_inbox")
      .select("id, notification_type, title, body, action_url, priority, read_at, created_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("notification_inbox")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null)
      .is("read_at", null),
  ]);

  if (preferencesResult.error) {
    if (isMissingNotificationsTable(preferencesResult.error)) {
      return {
        preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        summary: { unreadCount: 0, latest: [] },
        available: false,
      };
    }
    throw preferencesResult.error;
  }

  if (inboxResult.error) {
    if (isMissingNotificationsTable(inboxResult.error)) {
      return {
        preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        summary: { unreadCount: 0, latest: [] },
        available: false,
      };
    }
    throw inboxResult.error;
  }

  if (unreadCountResult.error) {
    if (isMissingNotificationsTable(unreadCountResult.error)) {
      return {
        preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        summary: { unreadCount: 0, latest: [] },
        available: false,
      };
    }
    throw unreadCountResult.error;
  }

  const preferences = preferencesResult.data
    ? mapPreferenceRow(preferencesResult.data)
    : await ensureNotificationPreferences(admin, userId);
  const latest = (inboxResult.data || []).map((item) => ({
    id: item.id,
    type: item.notification_type,
    title: item.title,
    body: item.body,
    actionUrl: item.action_url,
    priority: item.priority,
    readAt: item.read_at,
    createdAt: item.created_at,
  }));

  return {
    preferences,
    summary: {
      unreadCount: unreadCountResult.count || 0,
      latest,
    },
    available: true,
  };
}

export async function updateNotificationPreferences(admin, userId, preferences) {
  return ensureNotificationPreferences(admin, userId, preferences);
}

export async function createInAppNotification(admin, {
  userId,
  type,
  title,
  body = "",
  actionUrl = null,
  priority = "normal",
  metadata = {},
  dedupKey = null,
}) {
  if (!userId || !type || !title) return null;

  const preferences = await ensureNotificationPreferences(admin, userId);
  const topicKey = TOPIC_PREFS[type];
  if (!preferences.inAppEnabled || (topicKey && preferences[topicKey] === false)) {
    return null;
  }

  const row = {
    user_id: userId,
    notification_type: type,
    title: String(title).slice(0, 140),
    body: String(body || "").slice(0, 1000),
    action_url: actionUrl,
    priority,
    metadata,
    ...(dedupKey ? { dedup_key: String(dedupKey) } : {}),
  };

  // When a dedupKey is provided, use upsert with DO NOTHING so a second insert
  // of the same logical event (webhook retry, fan-out double-run) is a no-op.
  const query = dedupKey
    ? admin
        .from("notification_inbox")
        .upsert(row, { onConflict: "user_id,dedup_key", ignoreDuplicates: true })
        .select("id")
        .maybeSingle()
    : admin
        .from("notification_inbox")
        .insert(row)
        .select("id")
        .single();

  const { data, error } = await query;

  if (error) {
    if (isMissingNotificationsTable(error)) return null;
    throw error;
  }

  // data is null when upsert hit the dedup constraint (duplicate suppressed) — treated as success.
  return data;
}
