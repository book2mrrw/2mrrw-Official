const presentations = new Map();
const TRACE_LIMIT = 2000;
const trace = [];

function diagnosticsEnabled() {
  return (
    typeof window !== "undefined" &&
    (process.env.NODE_ENV === "development" ||
      process.env.NEXT_PUBLIC_RELEASE_PRESENTATION_TRACE === "1")
  );
}

function exposeDiagnostics() {
  if (!diagnosticsEnabled()) return;
  window.__2MRRW_RELEASE_PRESENTATION__ = {
    snapshot: () => Array.from(presentations.values(), (entry) => ({ ...entry })),
    trace: () => trace.map((event) => ({ ...event })),
  };
}

function emit(event, entry, meta = {}) {
  if (!diagnosticsEnabled()) return;
  const record = {
    event,
    ts: Date.now(),
    key: entry.key,
    releaseId: entry.releaseId,
    surface: entry.surface,
    revision: entry.revision,
    ...meta,
  };
  trace.push(record);
  if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT);
  exposeDiagnostics();
  console.debug("[release-presentation]", record);
}

function blankEntry(identity) {
  return {
    key: identity.key,
    releaseId: identity.releaseId,
    surface: identity.surface,
    revision: identity.revision,
    coverAssetIdentity: identity.coverAssetIdentity || null,
    coverResolvedUrl: null,
    coverRequested: false,
    coverLoaded: false,
    coverDecoded: false,
    coverReady: false,
    metadataReady: false,
    entitlementReady: false,
    entitlementIdentity: null,
    controlsReady: false,
    presentationReady: false,
    mounts: 0,
    updatedAt: Date.now(),
  };
}

function getEntry(identity) {
  if (!identity?.key || !identity?.releaseId) return null;
  let entry = presentations.get(identity.key);
  const revisionChanged = entry && entry.revision !== identity.revision;
  const coverChanged =
    entry &&
    entry.coverAssetIdentity &&
    identity.coverAssetIdentity &&
    entry.coverAssetIdentity !== identity.coverAssetIdentity;

  if (!entry || revisionChanged || coverChanged) {
    const previousRevision = entry?.revision || null;
    entry = blankEntry(identity);
    presentations.set(identity.key, entry);
    if (previousRevision) {
      emit("REVISION_CHANGE", entry, { previousRevision });
    }
  } else if (!entry.coverAssetIdentity && identity.coverAssetIdentity) {
    entry.coverAssetIdentity = identity.coverAssetIdentity;
  }
  return entry;
}

function updateReady(entry) {
  entry.coverReady = entry.coverLoaded && entry.coverDecoded;
  const ready =
    entry.coverReady &&
    entry.metadataReady &&
    entry.entitlementReady &&
    entry.controlsReady;
  if (ready && !entry.presentationReady) {
    entry.presentationReady = true;
    emit("PRESENTATION_READY", entry);
  }
  entry.updatedAt = Date.now();
}

export function isReleasePresentationReady(identity) {
  if (typeof window === "undefined") return false;
  const entry = presentations.get(identity?.key);
  return Boolean(
    entry &&
      entry.revision === identity.revision &&
      (!identity.coverAssetIdentity ||
        !entry.coverAssetIdentity ||
        entry.coverAssetIdentity === identity.coverAssetIdentity) &&
      entry.presentationReady
  );
}

export function getReleasePresentation(identity) {
  const entry = presentations.get(identity?.key);
  if (!entry || entry.revision !== identity?.revision) return null;
  return entry;
}

export function recordReleasePresentationEvent(identity, event, meta = {}) {
  const entry = getEntry(identity);
  if (!entry) return;

  switch (event) {
    case "MOUNT":
      entry.mounts += 1;
      emit(event, entry, { mounts: entry.mounts, ...meta });
      return;
    case "UNMOUNT":
      entry.mounts = Math.max(0, entry.mounts - 1);
      emit(event, entry, { mounts: entry.mounts, ...meta });
      return;
    case "RENDER":
      emit(event, entry, meta);
      return;
    case "COVER_REQUEST":
      if (!entry.coverRequested) {
        entry.coverRequested = true;
        emit(event, entry, meta);
      }
      break;
    case "COVER_LOAD":
      if (!entry.coverLoaded) {
        entry.coverLoaded = true;
        entry.coverResolvedUrl = meta.url || entry.coverAssetIdentity;
        emit(event, entry, meta);
      }
      break;
    case "COVER_DECODE":
      if (!entry.coverDecoded) {
        entry.coverDecoded = true;
        entry.coverResolvedUrl = meta.url || entry.coverResolvedUrl || entry.coverAssetIdentity;
        emit(event, entry, meta);
      }
      break;
    case "ENTITLEMENT_RESOLUTION":
      if (!entry.entitlementReady || entry.entitlementIdentity !== meta.entitlementIdentity) {
        entry.entitlementReady = true;
        entry.entitlementIdentity = meta.entitlementIdentity ?? null;
        emit(event, entry, meta);
      }
      break;
    case "CONTROLS_READY":
      if (!entry.controlsReady) {
        entry.controlsReady = true;
        emit(event, entry, meta);
      }
      break;
    case "METADATA_READY":
      entry.metadataReady = true;
      break;
    default:
      emit(event, entry, meta);
      return;
  }

  updateReady(entry);
}

export function resetReleasePresentationRegistryForTests() {
  presentations.clear();
  trace.length = 0;
}
