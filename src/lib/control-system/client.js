export const CONTROL_SYSTEM_API_ENV_KEY = "NEXT_PUBLIC_CONTROL_SYSTEM_API_URL";

const PUBLISHED_STATUSES = new Set(["active", "live", "public", "published", "released"]);

function browserControlSessionId() {
  if (typeof window === "undefined") return "";
  const key = "2mrrw_control_session_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const generated = window.crypto?.randomUUID?.() || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, generated);
  return generated;
}

export function getControlSystemApiUrl() {
  const rawUrl = process.env.NEXT_PUBLIC_CONTROL_SYSTEM_API_URL;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  return rawUrl.trim().replace(/\/+$/, "");
}

export function buildControlSystemUrl(path, params = {}) {
  const apiBaseUrl = getControlSystemApiUrl();
  if (!apiBaseUrl || !path) return null;

  const url = new URL(path.startsWith("/") ? `${apiBaseUrl}${path}` : `${apiBaseUrl}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return { apiBaseUrl, href: url.toString() };
}

export async function fetchControlSystemJson(path, { params, fetchOptions = {} } = {}) {
  const target = buildControlSystemUrl(path, params);
  if (!target) return { apiBaseUrl: "", ok: false, payload: null, status: 0 };

  try {
    const sessionId = browserControlSessionId();
    const response = await fetch(target.href, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      ...fetchOptions,
      headers: {
        Accept: "application/json",
        ...(sessionId ? { "x-control-session-id": sessionId } : {}),
        ...(fetchOptions.headers || {}),
      },
    });

    if (!response.ok) {
      return { apiBaseUrl: target.apiBaseUrl, ok: false, payload: null, status: response.status };
    }

    return {
      apiBaseUrl: target.apiBaseUrl,
      ok: true,
      payload: await response.json(),
      status: response.status,
    };
  } catch {
    return { apiBaseUrl: target.apiBaseUrl, ok: false, payload: null, status: 0 };
  }
}

export function extractControlSystemArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }

  return [];
}

export function extractControlSystemRecord(payload, keys = []) {
  if (payload?.data && !Array.isArray(payload.data)) return payload.data;

  for (const key of keys) {
    if (payload?.[key] && !Array.isArray(payload[key])) return payload[key];
    if (payload?.data?.[key] && !Array.isArray(payload.data[key])) return payload.data[key];
  }

  return null;
}

export function isPublishedControlRecord(record) {
  if (!record) return false;
  if (record.published === false || record.isPublished === false) return false;

  const rawStatus = record.status || record.publicationStatus || record.releaseStatus || record.visibility;
  if (!rawStatus) return true;
  return PUBLISHED_STATUSES.has(String(rawStatus).toLowerCase());
}
