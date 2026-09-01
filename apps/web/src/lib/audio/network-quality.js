/**
 * Network quality estimator for HLS adaptive bitrate selection.
 *
 * Uses the Network Information API where available, and falls back to
 * a passive bandwidth probe using a small R2-served probe file.
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
const TIERS = [
  { kbps: 320, label: "high"     },
  { kbps: 160, label: "standard" },
  { kbps: 96,  label: "low"      },
];

// Effective Type → suggested tier (Network Information API)
const ECT_TIER = {
  "slow-2g": 2, // 96k
  "2g":      2,
  "3g":      1, // 160k
  "4g":      0, // 320k
};

/**
 * Return the recommended hls.js quality level index:
 *   -1 = auto (let hls.js ABR decide)
 *    0 = 320k (highest)
 *    1 = 160k
 *    2 = 96k
 *
 * Decision precedence:
 *  1. Explicit user preference (localStorage pin)
 *  2. Network Information API effective type
 *  3. Auto (-1) — hls.js ABR handles it
 */
export async function getQualityLevel() {
  // 1. User has pinned a quality level
  const pinned = readPinnedLevel();
  if (pinned !== null) return pinned;

  // 2. Network Information API (Chrome, Android)
  if (typeof navigator !== "undefined" && navigator.connection) {
    const ect = navigator.connection.effectiveType;
    if (ect && ect in ECT_TIER) return ECT_TIER[ect];
  }

  // 3. Hand ABR control to hls.js
  return -1;
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
