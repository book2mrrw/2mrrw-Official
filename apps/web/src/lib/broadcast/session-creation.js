import { createHash, randomUUID } from "node:crypto";
import { ACCESS_POLICIES, REPLAY_POLICIES, SESSION_TYPES } from "./session-model.js";
import { BroadcastServiceError, validBroadcastId } from "./command-service.js";

const MUSIC_TYPES = new Set(["listening_session", "live_listening"]);
const fail = (message) => { throw new BroadcastServiceError(message, 400); };

export function normalizeSessionCreation(input) {
  if (!input || !validBroadcastId(input.sessionId)) fail("A stable session ID is required");
  if (!SESSION_TYPES.includes(input.type)) fail("Choose a supported session type");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 160) fail("Title must contain 1–160 characters");
  const accessPolicy = input.accessPolicy || "ADMIN";
  const replayPolicy = input.replayPolicy || "NO_REPLAY";
  if (!ACCESS_POLICIES.includes(accessPolicy) || !REPLAY_POLICIES.includes(replayPolicy)) fail("Invalid access or replay policy");
  const releaseId = input.releaseId ?? null;
  const productId = input.productId ?? null;
  if ((releaseId && !validBroadcastId(releaseId)) || (productId && !validBroadcastId(productId)) || (releaseId && productId)) fail("Choose one canonical project");
  if (MUSIC_TYPES.has(input.type) && !releaseId && !productId) fail("Choose a project for this listening session");
  if (input.liveBroadcastId != null && !validBroadcastId(input.liveBroadcastId)) fail("Invalid live broadcast identity");
  if (accessPolicy === "ENTRY" && !input.liveBroadcastId) fail("Entry access requires a linked live broadcast");
  const presentation = {};
  for (const key of ["showTitle", "showArtwork", "showTracklist"]) {
    const value = input.presentation?.[key] ?? true;
    if (typeof value !== "boolean") fail("Invalid presentation choice");
    presentation[key] = value;
  }
  const world = input.look?.world || "galaxy";
  if (!["galaxy", "vault", "moon", "sun", "capsule"].includes(world)) fail("Choose a supported session world");
  // Explicit projection: caller-supplied items, prepared flags, gains and timeline never enter authority.
  return { sessionId: input.sessionId, type: input.type, title, releaseId, productId,
    liveBroadcastId: input.liveBroadcastId || null, accessPolicy, replayPolicy, presentation, look: { world } };
}

export async function createBroadcastSession({ repository, resolveProject, actorId, input, now = Date.now, uuid = randomUUID }) {
  if (!validBroadcastId(actorId)) throw new BroadcastServiceError("Unauthorized", 403);
  const config = normalizeSessionCreation(input);
  const fingerprint = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  const existing = await repository.loadOwned(config.sessionId, actorId);
  if (existing) {
    if (existing.creation_fingerprint !== fingerprint) throw new BroadcastServiceError("SESSION_ID_CONFLICT", 409);
    return { session: existing.snapshot, duplicate: true };
  }
  const project = config.releaseId || config.productId ? await resolveProject(config) : null;
  if ((config.releaseId || config.productId) && !project) throw new BroadcastServiceError("Project not found", 404);
  if (project && (!project.items.length || project.items.length > 200)) fail("Project must contain 1–200 tracks");
  const at = now();
  const session = {
    id: config.sessionId, type: config.type, title: config.title,
    releaseId: project?.releaseId || null, productId: project?.productId || null,
    accessPolicy: config.accessPolicy, replayPolicy: config.replayPolicy,
    presentation: config.presentation, look: config.look,
    state: "DRAFT", sequence: 0, currentItemId: null, mediaPosition: 0,
    effectiveAt: at, isPlaying: false, musicGain: 1, videoPolicy: "muted",
    authorizationEpoch: 0, createdAt: at, updatedAt: at,
    scheduledAt: null, startedAt: null, endedAt: null,
    items: (project?.items || []).map((item, position) => ({
      id: uuid(), trackId: item.trackId || null, catalogTrackId: item.catalogTrackId || null,
      productId: item.productId || null, title: item.title || "", durationSeconds: item.durationSeconds || null,
      position, excluded: false, completed: false,
      // Only the server project resolver can establish readiness.
      prepared: item.prepared === true,
    })),
  };
  return repository.create({ id: session.id, host_id: actorId, release_id: session.releaseId,
    live_broadcast_id: config.liveBroadcastId, creation_fingerprint: fingerprint, sequence: 0, snapshot: session });
}
