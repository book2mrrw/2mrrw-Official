/**
 * Single source of truth for the live-chat Realtime Broadcast channel name —
 * shared between the server (which sends after authorizing + storing a
 * message) and the client (which only ever listens, never subscribes to the
 * underlying table directly).
 */
export function liveChatChannelName(broadcastId) {
  return `live-chat:${broadcastId}`;
}
