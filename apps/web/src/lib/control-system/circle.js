import {
  extractControlSystemArray,
  fetchControlSystemJson,
  isPublishedControlRecord,
} from "./client";

const CIRCLE_EVENT_LABELS = new Map([
  ["active", "2MRRW active"],
  ["creator_active", "2MRRW active"],
  ["2mrrw_active", "2MRRW active"],
  ["replied", "2MRRW replied"],
  ["reply", "2MRRW replied"],
  ["creator_replied", "2MRRW replied"],
  ["2mrrw_replied", "2MRRW replied"],
  ["live", "2MRRW is live"],
  ["is_live", "2MRRW is live"],
  ["creator_live", "2MRRW is live"],
  ["2mrrw_is_live", "2MRRW is live"],
  ["highlighted_comment", "2MRRW highlighted a comment"],
  ["highlight", "2MRRW highlighted a comment"],
  ["comment_highlighted", "2MRRW highlighted a comment"],
  ["2mrrw_highlighted_a_comment", "2MRRW highlighted a comment"],
  ["reacted", "2MRRW reacted"],
  ["reaction", "2MRRW reacted"],
  ["creator_reacted", "2MRRW reacted"],
  ["2mrrw_reacted", "2MRRW reacted"],
]);

function normalizeEventType(record) {
  return String(record?.type || record?.eventType || record?.event_type || record?.action || "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function mapControlSystemCircleEvent(record) {
  const eventType = normalizeEventType(record);
  if (!CIRCLE_EVENT_LABELS.has(eventType)) return null;

  return {
    id: record?.id || `${eventType}-${record?.createdAt || record?.created_at || record?.targetId || record?.target_id || "event"}`,
    type: eventType,
    label: record?.label || CIRCLE_EVENT_LABELS.get(eventType),
    message: record?.message || record?.content || "",
    createdAt: record?.createdAt || record?.created_at || null,
    targetId: record?.targetId || record?.target_id || null,
    targetType: record?.targetType || record?.target_type || null,
    actor: record?.actor || record?.creator || "2MRRW",
    metadata: record?.metadata || {},
  };
}

export async function getControlSystemCircleEvents({ fallbackEvents = [] } = {}) {
  const { ok, payload } = await fetchControlSystemJson("/api/circle/events");
  if (!ok) return fallbackEvents;

  const events = extractControlSystemArray(payload, ["events", "circleEvents", "items"])
    .filter(isPublishedControlRecord)
    .map(mapControlSystemCircleEvent)
    .filter(Boolean);

  return events.length > 0 ? events : fallbackEvents;
}
