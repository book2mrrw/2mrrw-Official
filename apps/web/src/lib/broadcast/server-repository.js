import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";

function checked(result) {
  if (result.error) throw new Error("Broadcast storage unavailable", { cause: result.error });
  return result.data;
}

export function broadcastRepository(client = getAdminClient()) {
  return {
    async loadOwned(sessionId, actorId) {
      return checked(await client.from("broadcast_sessions").select("id,host_id,snapshot,creation_fingerprint")
        .eq("id", sessionId).eq("host_id", actorId).maybeSingle());
    },
    async create(row) {
      const result = await client.from("broadcast_sessions").insert(row).select("snapshot").single();
      if (result.error?.code === "23505") {
        const existing = checked(await client.from("broadcast_sessions").select("snapshot,creation_fingerprint")
          .eq("id", row.id).eq("host_id", row.host_id).maybeSingle());
        if (!existing || existing.creation_fingerprint !== row.creation_fingerprint) {
          const { BroadcastServiceError } = await import("./command-service.js");
          throw new BroadcastServiceError("SESSION_ID_CONFLICT", 409);
        }
        return { session: existing.snapshot, duplicate: true };
      }
      return { session: checked(result).snapshot, duplicate: false };
    },
    async findCommand(sessionId, commandId) {
      return checked(await client.from("broadcast_session_events").select("id,command_fingerprint")
        .eq("session_id", sessionId).eq("command_id", commandId).maybeSingle());
    },
    async commit({ sessionId, actorId, command, fingerprint, snapshot, proposedAt }) {
      return checked(await client.rpc("commit_broadcast_command", {
        p_session_id: sessionId, p_actor_id: actorId, p_command_id: command.commandId,
        p_fingerprint: fingerprint, p_expected_sequence: command.expectedSequence,
        p_command_type: command.type, p_snapshot: snapshot, p_proposed_at: proposedAt,
      }));
    },
  };
}
