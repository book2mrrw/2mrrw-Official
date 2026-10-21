/** Serializes draft snapshots; every successful write advances the server CAS revision. */
export function createDraftSaveQueue({ send, onState = () => {}, onSaved = () => {} }) {
  let revision = null, tail = Promise.resolve(), lastSaved = null, conflict = null, paused = false;
  return {
    restoreRevision(value) { revision = value || null; conflict = null; lastSaved = null; },
    pause() { paused = true; },
    resume() { paused = false; },
    enqueue(snapshot, options = {}) {
      if (!snapshot || paused) return Promise.resolve();
      const task = tail.catch(() => {}).then(async () => {
        if (paused) return;
        if (conflict) throw conflict;
        const key = JSON.stringify(snapshot);
        if (key === lastSaved) return;
        onState({ status: 'saving' });
        const response = await send(snapshot, revision, options);
        if (!response.ok) {
          const error = new Error(response.error || 'Draft could not be saved. Your entered values remain in this tab.');
          if (response.status === 409) conflict = error;
          throw error;
        }
        revision = response.saved_at;
        lastSaved = key;
        onSaved(revision);
        onState({ status: 'saved' });
      });
      tail = task.catch(error => { onState({ status: 'error', error: error.message }); throw error; });
      // The caller may deliberately fire-and-forget during pagehide. Keep a
      // rejection handler attached while still returning the real failure.
      tail.catch(() => {});
      return tail;
    },
  };
}
