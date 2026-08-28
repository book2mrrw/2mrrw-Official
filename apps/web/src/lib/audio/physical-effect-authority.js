/**
 * Generic physical-effect authority modes.
 *
 * This module intentionally has no Playback Core, React, media, or vendor
 * dependency. The transport layer understands only whether an operation is a
 * protected captured-authority operation or an untrusted legacy/control
 * operation. A LEGACY label never grants production audibility by itself.
 */
export const PhysicalEffectAuthorityMode = Object.freeze({
  CORE: "CORE",
  CORE_CURRENT: "CORE_CURRENT",
  LEGACY: "LEGACY",
});

let installedGuard = null;
let installationSequence = 0;

/**
 * Install the single session-wide read-only guard used by recovery and
 * lifecycle work acting on the currently-authoritative media. The disposer is
 * generation-safe, so destroying Core A cannot uninstall a newer Core B guard.
 */
export function installCurrentPhysicalEffectGuard(guard) {
  if (!guard || typeof guard.canApplyCurrentEffect !== "function") {
    throw new TypeError("[physical-effect-authority] canApplyCurrentEffect is required");
  }
  const installationId = ++installationSequence;
  installedGuard = { installationId, guard };
  return () => {
    if (installedGuard?.installationId === installationId) installedGuard = null;
  };
}

/** Read-only access for the generic media leaf. */
export function getCurrentPhysicalEffectGuard() {
  return installedGuard?.guard ?? null;
}
