/** Completion must update desired transport, not only the UI/physical snapshot. */
export function completeQueuePlayback(core, track) {
  const identity = track?.id ?? track?.trackId ?? track?.slug ?? null;
  if (!identity || core.desiredState.requestedMediaIdentity !== identity) return false;
  core.port.pause({ source: "system" });
  return true;
}
