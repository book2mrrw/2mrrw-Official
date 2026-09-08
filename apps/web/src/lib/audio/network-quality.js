/**
 * Network quality estimator for HLS adaptive bitrate selection.
 *
 * Uses the Network Information API where available, otherwise leaves bandwidth estimation to hls.js.
 *
 * The quality preference is persisted to localStorage so the player
 * starts at the right tier across sessions instead of always starting
 * at the highest bitrate and immediately downgrading (which causes a
 * visible stutter on slow connections).
 *
 * Integration:
 *   import { getQualityLevel } from "@/lib/audio/network-quality";
 *   hlsEngine.setQualityLevel(await getQualityLevel());
 */

const STORAGE_KEY = "2mrrw-hls-quality-level";

// Bitrate tiers in the master playlist (highest → lowest).
// Must match the order emitted by /api/library/hls.
// 64k is a data-saver floor: below it, AAC-LC quality degrades audibly
// (warble/metallic artifacts), so it's the last rung rather than a lower one.
const TIERS = [
  { kbps: 320, label: "high"       },
  { kbps: 160, label: "standard"   },
  { kbps: 96,  label: "low"        },
  { kbps: 64,  label: "data-saver" },
];

// Effective Type → suggested tier (Network Information API)
// slow-2g/2g start at the 64k floor rather than 96k: 96k needs ~96-120kbps
// sustained once HTTP/segment overhead is counted, which is above what those
// two ECT buckets reliably sustain — starting there just traded one stall
// for another. hls.js's live ABR (abrBandWidthUpFactor: 0.7) climbs off this
// floor within a few segments if the connection turns out better than the
// coarse ECT guess. 3g/4g are unchanged — no evidence they need a downgrade.
const ECT_TIER = {
  "slow-2g": 3, // 64k
  "2g":      3, // 64k
  "3g":      1, // 160k
  "4g":      0, // 320k
};

/** Explicit menu selection only. Network hints must never pin ABR. */
export async function getQualityLevel() {
  return readPinnedLevel() ?? -1;
}

/** Starting tier only: live ABR remains free to move in either direction. */
export function getStartupQualityLevel() {
  if (typeof navigator === "undefined") return -1;
  const connection = navigator.connection;
  if (connection?.saveData) return 3;
  return ECT_TIER[connection?.effectiveType] ?? -1;
}

// Manifest-fetch patience by connection quality. This is deliberately separate
// from ABR tier selection above: a manifest can be slow for reasons that have
// nothing to do with the client's bandwidth (a cold serverless function, a
// brief server hiccup), and a flat generous timeout makes every session —
// fast ones included — eat that same worst case. Fast/unknown connections
// (4g, desktop wifi, no Network Information API) keep the original tight
// budget so "instant playback" is never traded away to buy patience that
// only slow-2g/2g/3g actually need.
const ECT_MANIFEST_TIMEOUT_MS = {
  "slow-2g": 7000,
  "2g":      6000,
  "3g":      4500,
};
const DEFAULT_MANIFEST_TIMEOUT_MS = 3000; // 4g and unknown — the common/fast case

/**
 * Return how long HLSEngine should wait for the manifest before giving up
 * and falling back to progressive download.
 */
export function getManifestTimeoutMs() {
  if (typeof navigator !== "undefined" && navigator.connection) {
    const ect = navigator.connection.effectiveType;
    if (ect && ect in ECT_MANIFEST_TIMEOUT_MS) return ECT_MANIFEST_TIMEOUT_MS[ect];
  }
  return DEFAULT_MANIFEST_TIMEOUT_MS;
}

/**
 * Pin a quality level in localStorage (user quality menu option).
 * Pass null to clear the pin and return to auto.
 * @param {number|null} levelIndex
 */
export function setQualityPreference(levelIndex) {
  try {
    if (levelIndex === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(levelIndex));
    }
  } catch {}
}

/** @returns {number|null} null = no pin, otherwise 0/1/2 */
function readPinnedLevel() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return null;
    const n = parseInt(v, 10);
    return n >= 0 && n < TIERS.length ? n : null;
  } catch { return null; }
}

/**
 * Human-readable label for a level index.
 * @param {number} levelIndex  -1 = auto
 */
export function qualityLabel(levelIndex) {
  if (levelIndex < 0) return "Auto";
  return TIERS[levelIndex]?.label ?? "Auto";
}

/**
 * All available tiers for a quality-selection UI.
 * @returns {Array<{ index: number, kbps: number, label: string }>}
 */
export function qualityTiers() {
  return [
    { index: -1, kbps: null, label: "Auto" },
    ...TIERS.map((t, i) => ({ index: i, ...t })),
  ];
}
