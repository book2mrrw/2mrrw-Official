import { expectedPosition } from "./session-clock.js";

export const SESSION_TYPES = Object.freeze(["regular_live", "listening_session", "live_listening", "interview", "concert", "mic_drop", "podcast"]);
export const SESSION_STATES = Object.freeze(["DRAFT", "SCHEDULED", "PRE_SHOW", "LIVE_INTRO", "TRACK_PLAYBACK", "ARTIST_COMMENTARY", "AUDIENCE_REACTION", "INTERMISSION", "FINALE", "AFTERSHOW", "ENDED"]);
export const ACCESS_POLICIES = Object.freeze(["PUBLIC", "ENTRY", "PURCHASER", "SUBSCRIBER", "COLLECTOR_CARD_OWNER", "INVITE_ONLY", "PRIVATE_PRESS_INDUSTRY", "ADMIN"]);
export const REPLAY_POLICIES = Object.freeze(["NO_REPLAY", "PRIVATE_ARCHIVE", "VAULT_REPLAY", "SUBSCRIBER_REPLAY", "COLLECTOR_REPLAY", "PUBLIC_REPLAY"]);
export const VISUAL_CUES = Object.freeze(["PRE_SHOW", "SUN_ACTIVITY", "MOON_REVEAL", "STARFIELD_SHIFT", "VAULT_OPEN", "TRACK_INTRO", "TRACK_PEAK", "COMMENTARY", "INTERMISSION", "FINALE", "AFTERSHOW"]);
const SETUP = new Set(["DRAFT", "SCHEDULED", "PRE_SHOW"]);
const LIVE = new Set(["LIVE_INTRO", "TRACK_PLAYBACK", "ARTIST_COMMENTARY", "AUDIENCE_REACTION", "INTERMISSION", "FINALE", "AFTERSHOW"]);

export class SessionCommandError extends Error {
  constructor(message, code = "INVALID_COMMAND") { super(message); this.code = code; }
}
function requireCondition(value, message) { if (!value) throw new SessionCommandError(message); }
function enumValue(value, values, label) { requireCondition(values.includes(value), `Invalid ${label}`); return value; }
function currentItem(session) { return session.items.find((item) => item.id === session.currentItemId); }
function playable(item) { return item && item.prepared === true && !item.excluded && !item.completed; }

/** Pure server command validation. Persistence must CAS sequence + append the event atomically. */
export function applySessionCommand(previous, command, now, { mediaReadiness } = {}) {
  requireCondition(Number.isFinite(now), "Authoritative time is required");
  requireCondition(previous && SESSION_STATES.includes(previous.state), "Unknown session state");
  requireCondition(SESSION_TYPES.includes(previous.type), "Unknown session type");
  requireCondition(Number.isSafeInteger(previous.sequence) && previous.sequence >= 0 && previous.sequence < Number.MAX_SAFE_INTEGER, "Invalid session sequence");
  requireCondition(previous.state !== "ENDED", "Ended sessions are immutable");
  requireCondition(command && typeof command.type === "string", "Command type is required");
  requireCondition(command.expectedSequence === previous.sequence, "Session changed; reconcile before trying again");
  const payload = command.payload || {};
  requireCondition(typeof payload === "object" && !Array.isArray(payload), "Invalid command payload");
  const session = { ...previous, items: previous.items.map((item) => ({ ...item })) };
  const position = expectedPosition(previous, now);
  const freeze = () => { session.mediaPosition = position; session.effectiveAt = now; session.isPlaying = false; };
  const select = (itemId) => {
    const item = session.items.find((entry) => entry.id === itemId);
    requireCondition(playable(item), "Track is unavailable, excluded, or already completed");
    session.currentItemId = item.id;
    session.mediaPosition = 0;
    session.effectiveAt = now;
    session.isPlaying = false;
  };
  const start = () => {
    requireCondition(playable(currentItem(session)), "Cue an available track first");
    session.state = "TRACK_PLAYBACK";
    session.isPlaying = true;
    session.effectiveAt = now;
    session.musicGain = 1;
    session.videoPolicy = "muted";
  };
  switch (command.type) {
    case "PREPARE_MEDIA": {
      requireCondition(SETUP.has(previous.state) && !previous.isPlaying, "Prepare media before going live");
      requireCondition(Array.isArray(mediaReadiness) && mediaReadiness.length === session.items.length,
        "Server media verification is required");
      const verified = new Map(mediaReadiness.map((item) => [item.id, item.prepared]));
      requireCondition(verified.size === session.items.length && session.items.every((item) => typeof verified.get(item.id) === "boolean"),
        "Media verification must cover every session item");
      session.items = session.items.map((item) => ({ ...item, prepared: verified.get(item.id) }));
      session.mediaPreparedAt = now;
      break;
    }
    case "SCHEDULE": {
      requireCondition(SETUP.has(previous.state), "Only a prepared session can be scheduled");
      requireCondition(Number.isFinite(payload.scheduledAt) && payload.scheduledAt > now, "Choose a future session time");
      session.scheduledAt = payload.scheduledAt;
      session.state = "SCHEDULED";
      break;
    }
    case "PRE_SHOW":
      requireCondition(SETUP.has(previous.state), "Pre-show is only available before going live");
      session.state = "PRE_SHOW";
      break;
    case "GO_LIVE":
      requireCondition(SETUP.has(previous.state), "Session has already started");
      if (["listening_session", "live_listening"].includes(session.type)) requireCondition(session.items.some(playable), "Choose at least one prepared track");
      session.state = "LIVE_INTRO";
      session.startedAt = now;
      break;
    case "CUE_TRACK":
      requireCondition(!previous.isPlaying, "Pause or end the current track before cueing another");
      select(payload.itemId);
      break;
    case "START_TRACK":
      requireCondition(LIVE.has(previous.state), "Go live before starting music");
      requireCondition(!previous.isPlaying, "Music is already playing");
      if (payload.itemId && payload.itemId !== previous.currentItemId) select(payload.itemId);
      start();
      break;
    case "PAUSE_TRACK":
      requireCondition(previous.isPlaying, "Music is already paused");
      freeze();
      break;
    case "RESUME_TRACK":
      requireCondition(LIVE.has(previous.state) && !previous.isPlaying, "Music cannot resume in this state");
      start();
      break;
    case "END_TRACK":
      requireCondition(LIVE.has(previous.state) && currentItem(session), "No live track to end");
      freeze();
      currentItem(session).completed = true;
      session.state = "AUDIENCE_REACTION";
      break;
    case "NEXT_TRACK": {
      requireCondition(LIVE.has(previous.state), "Go live before advancing tracks");
      const current = currentItem(session);
      const next = session.items.find((item) => playable(item) && item.id !== current?.id && (!current || item.position > current.position));
      requireCondition(next, "No upcoming track remains");
      if (current) current.completed = true;
      select(next.id);
      start();
      break;
    }
    case "PREVIOUS_TRACK":
      requireCondition(SETUP.has(previous.state), "Completed live tracks cannot be restarted by previous-track navigation");
      { const current = currentItem(session); const prior = [...session.items].reverse().find((item) => playable(item) && current && item.position < current.position); requireCondition(prior, "No previous track"); select(prior.id); }
      break;
    case "START_COMMENTARY":
    case "START_REACTION":
    case "INTERMISSION":
    case "FINALE":
    case "AFTERSHOW":
      requireCondition(LIVE.has(previous.state), "Go live before changing live segments");
      freeze();
      session.state = { START_COMMENTARY: "ARTIST_COMMENTARY", START_REACTION: "AUDIENCE_REACTION", INTERMISSION: "INTERMISSION", FINALE: "FINALE", AFTERSHOW: "AFTERSHOW" }[command.type];
      session.videoPolicy = "artist";
      break;
    case "END_COMMENTARY":
    case "END_INTERMISSION":
      requireCondition(previous.state === (command.type === "END_COMMENTARY" ? "ARTIST_COMMENTARY" : "INTERMISSION"), "Session is not in that segment");
      session.state = "LIVE_INTRO";
      break;
    case "END_SESSION":
      freeze();
      session.state = "ENDED";
      session.endedAt = now;
      session.authorizationEpoch = (previous.authorizationEpoch || 0) + 1;
      session.videoPolicy = "muted";
      break;
    case "REORDER_TRACKS": {
      const ids = payload.itemIds;
      requireCondition(Array.isArray(ids) && ids.length === session.items.length && new Set(ids).size === ids.length, "Provide each session item exactly once");
      const lookup = new Map(session.items.map((item) => [item.id, item]));
      requireCondition(ids.every((id) => lookup.has(id)), "Track does not belong to this session");
      for (const item of session.items) {
        if (item.completed || (LIVE.has(previous.state) && item.id === previous.currentItemId)) {
          requireCondition(ids.indexOf(item.id) === item.position, "Current and completed tracks cannot move");
        }
      }
      session.items = ids.map((id, position) => ({ ...lookup.get(id), position }));
      break;
    }
    case "EXCLUDE_TRACK": {
      const item = session.items.find((entry) => entry.id === payload.itemId);
      requireCondition(item && typeof payload.excluded === "boolean", "Choose a session track");
      requireCondition(!item.completed && item.id !== previous.currentItemId, "Current and completed tracks cannot be excluded");
      item.excluded = payload.excluded;
      break;
    }
    case "SET_MIX":
      requireCondition(typeof payload.musicGain === "number" && Number.isFinite(payload.musicGain) && payload.musicGain >= 0 && payload.musicGain <= 1, "Music level must be between 0 and 1");
      session.musicGain = payload.musicGain;
      session.videoPolicy = enumValue(payload.videoPolicy, ["muted", "artist"], "video audio policy");
      requireCondition(!session.isPlaying || session.videoPolicy === "muted" || session.audioPolicy?.artistFeedMusicFree === true, "Artist audio over music requires a verified music-free artist feed");
      break;
    case "VISUAL_CUE":
      session.visualCue = { cue: enumValue(payload.cue, VISUAL_CUES, "visual cue"), effectiveAt: now, sequence: previous.sequence + 1 };
      break;
    case "UPDATE_CONFIGURATION":
      requireCondition(SETUP.has(previous.state), "Audience and session configuration lock once live");
      if (payload.title !== undefined) { requireCondition(typeof payload.title === "string" && payload.title.trim().length > 0 && payload.title.length <= 160, "Title must contain 1–160 characters"); session.title = payload.title.trim(); }
      if (payload.accessPolicy !== undefined) session.accessPolicy = enumValue(payload.accessPolicy, ACCESS_POLICIES, "access policy");
      if (payload.replayPolicy !== undefined) session.replayPolicy = enumValue(payload.replayPolicy, REPLAY_POLICIES, "replay policy");
      if (payload.presentation !== undefined) {
        requireCondition(payload.presentation && ["showTitle", "showArtwork", "showTracklist"].every((key) => typeof payload.presentation[key] === "boolean"), "Choose each presentation visibility option");
        session.presentation = Object.fromEntries(["showTitle", "showArtwork", "showTracklist"].map((key) => [key, payload.presentation[key]]));
      }
      break;
    default: throw new SessionCommandError("Unknown Broadcast command");
  }
  session.sequence = previous.sequence + 1;
  session.updatedAt = now;
  return session;
}
