/** Gesture-time preparation of the existing, empty media element only.
 * Never creates an element, changes loaded content, or grants media authority.
 * A successful play request applies to this element, not another silent player.
 */
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";

const ACTIVATION_SOURCE = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
const pending = new WeakMap();
const activated = new WeakSet();
const awaitingSource = new WeakSet();
const ACTIVATION_TIMEOUT_MS = 1500;

export function isMediaActivationSource(audio) {
  return Boolean(audio && (audio.getAttribute?.("src") || audio.src) === ACTIVATION_SOURCE);
}

export function shouldSuppressActivationEvents(audio) {
  return isMediaActivationSource(audio) || awaitingSource.has(audio);
}

export function captureMediaActivation(audio, {
  userActive = globalThis.navigator?.userActivation?.isActive === true,
} = {}) {
  if (!audio || !userActive || activated.has(audio) || pending.has(audio)) return;
  // Do not disrupt an existing track, buffer, seek, or preload. Permission on a
  // previously played element is retained by keeping that same element alive.
  if ((audio.getAttribute?.("src") || audio.src) && !isMediaActivationSource(audio)) return;
  const operation = { finish: null, promise: null };
  let timer;
  operation.promise = new Promise(resolve => {
    let settled = false;
    operation.finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A late promise must never pause a successor source or a cancelled play.
      if (isMediaActivationSource(audio)) audio.pause();
      if (!error) activated.add(audio);
      else reportPlaybackDiagnostic({ level: "warn", code: "MEDIA_ACTIVATION_FAILED",
        command: "PREPARE", error, context: { stage: "gesture_activation" } });
      resolve();
    };
  });
  pending.set(audio, operation);
  awaitingSource.add(audio);
  const onSourceStart = () => {
    if (isMediaActivationSource(audio)) return;
    awaitingSource.delete(audio);
    audio.removeEventListener?.("loadstart", onSourceStart);
  };
  audio.addEventListener?.("loadstart", onSourceStart);
  timer = setTimeout(() => operation.finish(Object.assign(new Error("Media activation deadline exceeded"),
    { name: "TimeoutError" })), ACTIVATION_TIMEOUT_MS);
  try {
    audio.src = ACTIVATION_SOURCE;
    // This call MUST remain synchronous in the originating gesture stack.
    const result = audio.play();
    Promise.resolve(result).then(() => operation.finish(), operation.finish);
  } catch (error) { operation.finish(error); }
}

export function finishMediaActivation(audio) {
  const operation = audio && pending.get(audio);
  if (!operation) return;
  return operation.promise.then(() => {
    if (pending.get(audio) === operation) pending.delete(audio);
  });
}

export function cancelMediaActivation(audio) {
  const operation = audio && pending.get(audio);
  if (!operation) return;
  operation.finish(Object.assign(new Error("Media activation cancelled"), { name: "AbortError" }));
  pending.delete(audio);
}
