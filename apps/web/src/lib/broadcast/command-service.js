import { createHash } from "node:crypto";
import { applySessionCommand } from "./session-model.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validBroadcastId(value) { return typeof value === "string" && UUID.test(value); }

export class BroadcastServiceError extends Error {
  constructor(code, status, session = undefined) { super(code); this.code = code; this.status = status; this.session = session; }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function validateBroadcastCommand(command) {
  if (!command || !validBroadcastId(command.commandId) || !Number.isSafeInteger(command.expectedSequence)
    || command.expectedSequence < 0 || typeof command.type !== "string" || command.type.length > 64
    || !command.payload || typeof command.payload !== "object" || Array.isArray(command.payload)) {
    throw new BroadcastServiceError("INVALID_COMMAND", 400);
  }
  if (JSON.stringify(command).length > 16384) throw new BroadcastServiceError("COMMAND_TOO_LARGE", 413);
  return createHash("sha256").update(JSON.stringify(canonical({
    expectedSequence: command.expectedSequence, type: command.type, payload: command.payload,
  }))).digest("hex");
}

/** repository.commit must atomically lock, CAS, append event, and replace snapshot. */
export async function executeBroadcastCommand({ repository, sessionId, actorId, command, prepareMedia, now = Date.now }) {
  if (!validBroadcastId(sessionId) || !validBroadcastId(actorId)) throw new BroadcastServiceError("NOT_FOUND", 404);
  const fingerprint = validateBroadcastCommand(command);
  const row = await repository.loadOwned(sessionId, actorId);
  if (!row) throw new BroadcastServiceError("NOT_FOUND", 404);
  const previous = await repository.findCommand(sessionId, command.commandId);
  if (previous) {
    if (previous.command_fingerprint !== fingerprint) throw new BroadcastServiceError("IDEMPOTENCY_CONFLICT", 409);
    // A retry acknowledges its original event, but returns CURRENT state, never an old playback position.
    const latest = await repository.loadOwned(sessionId, actorId);
    if (!latest) throw new BroadcastServiceError("NOT_FOUND", 404);
    return { session: latest.snapshot, eventId: previous.id, duplicate: true };
  }
  if (row.snapshot.sequence !== command.expectedSequence) throw new BroadcastServiceError("SEQUENCE_CONFLICT", 409, row.snapshot);
  let mediaReadiness;
  if (command.type === "PREPARE_MEDIA") {
    if (!["DRAFT", "SCHEDULED", "PRE_SHOW"].includes(row.snapshot.state) || row.snapshot.isPlaying) {
      throw new BroadcastServiceError("Prepare media before going live", 422);
    }
    if (!prepareMedia) throw new BroadcastServiceError("Media verification unavailable", 503);
    mediaReadiness = await prepareMedia(row.snapshot);
  }
  const proposedAt = now();
  let snapshot;
  try { snapshot = applySessionCommand(row.snapshot, command, proposedAt, { mediaReadiness }); }
  catch (error) {
    if (error.code === "INVALID_COMMAND") throw new BroadcastServiceError(error.message, 422);
    throw error;
  }
  const result = await repository.commit({ sessionId, actorId, command, fingerprint, snapshot, proposedAt });
  if (result.error) {
    const status = { NOT_FOUND: 404, FORBIDDEN: 403, SEQUENCE_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, SESSION_ENDED: 409, CLOCK_CONFLICT: 409 }[result.error] || 503;
    throw new BroadcastServiceError(result.error, status, result.session);
  }
  return result;
}
