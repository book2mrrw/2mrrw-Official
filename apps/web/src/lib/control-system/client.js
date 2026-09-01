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

let warnedMissingControlSystemUrl = false;

export function getControlSystemApiUrl() {
  const rawUrl =
    process.env.NEXT_PUBLIC_CONTROL_SYSTEM_API_URL ||
    process.env.NEXT_PUBLIC_CONTROL_SYSTEM_URL;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    if (!warnedMissingControlSystemUrl) {
      warnedMissingControlSystemUrl = true;
      console.warn(
        "[2MRRW Storefront] NEXT_PUBLIC_CONTROL_SYSTEM_API_URL is not set — release catalog will fall back to hardcoded data only."
      );
    }
    return "";
  }
  return rawUrl.trim().replace(/\/+$/, "");
}

export function buildControlSystemUrl(path, params = {}) {
  const apiBaseUrl = getControlSystemApiUrl();
  if (!apiBaseUrl || !path) return null;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isBrowser = typeof window !== "undefined";
  const shouldUseSameOrigin = isBrowser && normalizedPath.startsWith("/api/");
  const resolvedApiBaseUrl = shouldUseSameOrigin ? window.location.origin : apiBaseUrl;
  const url = shouldUseSameOrigin
    ? new URL(normalizedPath, window.location.origin)
    : new URL(path.startsWith("/") ? `${apiBaseUrl}${path}` : `${apiBaseUrl}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  const href = shouldUseSameOrigin ? `${url.pathname}${url.search}` : url.toString();
  return { apiBaseUrl: resolvedApiBaseUrl, href };
}

export async function fetchControlSystemJson(path, { params, fetchOptions = {} } = {}) {
  const target = buildControlSystemUrl(path, params);
  if (!target) return { apiBaseUrl: "", ok: false, payload: null, status: 0 };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  // Exclude headers and signal from the spread — headers are merged explicitly below,
  // avoiding a silent duplicate-key override in the fetch options object.
  const { signal: externalSignal, headers: _callerHeaders, ...restFetchOptions } = fetchOptions;

  const upstreamOnAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", upstreamOnAbort);
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener("abort", upstreamOnAbort);
  };

  try {
    const sessionId = browserControlSessionId();
    const isServer = typeof window === "undefined";
    const response = await fetch(target.href, {
      method: "GET",
      credentials: "include",
      ...restFetchOptions,
      // Server: ISR — cache for 30 s so repeated SSR/RSC calls hit Next.js cache.
      // Client: no-store — always fresh (browser already has its own request cache).
      // NOTE: combining cache:"no-store" with next.revalidate conflicts in Next.js;
      // next.revalidate only works without an explicit cache directive.
      ...(isServer ? { next: { revalidate: 30 } } : { cache: "no-store" }),
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(sessionId ? { "x-control-session-id": sessionId } : {}),
        ...(fetchOptions.headers || {}),
      },
    });

    if (!response.ok) {
      cleanup();
      return { apiBaseUrl: target.apiBaseUrl, ok: false, payload: null, status: response.status };
    }

    const payload = await response.json();
    cleanup();
    return {
      apiBaseUrl: target.apiBaseUrl,
      ok: true,
      payload,
      status: response.status,
    };
  } catch (err) {
    cleanup();
    if (err?.name === "AbortError") {
      console.warn("[ControlSystem] Request timed out:", path);
    }
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
