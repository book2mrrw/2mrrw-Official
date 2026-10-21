/** A host/browser promise may never settle during an interruption. */
export function withRecoveryDeadline(promise, { timeoutMs = 2000, onTimeout } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout?.(); } catch (error) { reject(error); return; }
      reject(Object.assign(new Error("Playback recovery timed out"), { code: "RECOVERY_TIMEOUT" }));
    }, timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
