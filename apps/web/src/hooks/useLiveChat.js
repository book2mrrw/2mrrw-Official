"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { liveChatChannelName } from "@/lib/live/chat-channel";

const MAX_RENDERED_MESSAGES = 200;

/**
 * Live chat, fully isolated from the audio/video playback layer — a chat
 * failure here can never touch the player, and a player failure can never
 * touch chat. Messages arrive over a Supabase Realtime Broadcast channel the
 * server sends to after authorizing + storing each one (see
 * api/live/chat/send); this hook never subscribes to the underlying table.
 */
export function useLiveChat({ broadcastId, active }) {
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!active || !broadcastId) {
      setMessages([]);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/live/chat/history", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && Array.isArray(data.messages)) setMessages(data.messages);
      } catch {
        // History is a nice-to-have on join — live messages still arrive
        // over the channel below even if this fetch fails.
      }
    })();

    const supabase = createClient();
    const channel = supabase.channel(liveChatChannelName(broadcastId));
    channelRef.current = channel;

    channel.on("broadcast", { event: "message" }, ({ payload }) => {
      setMessages((current) => {
        if (current.some((m) => m.id === payload.id)) return current;
        const next = [...current, payload];
        return next.length > MAX_RENDERED_MESSAGES
          ? next.slice(next.length - MAX_RENDERED_MESSAGES)
          : next;
      });
    });

    channel.subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [broadcastId, active]);

  const sendMessage = useCallback(async (body) => {
    const trimmed = String(body || "").trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/live/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Message failed to send");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setSending(false);
    }
  }, []);

  return { messages, sendMessage, sending, error };
}
