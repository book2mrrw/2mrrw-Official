"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useLiveBroadcast } from "@/components/home/LiveCountdownContext";
import { AdminVerificationOverlay } from "@/components/admin/AdminVerificationOverlay";
import { RECOVERABLE_ADMIN_AUTH_CODES } from "@/lib/auth/admin-authority-diagnostics";
import { WhipPublisher } from "@/lib/livestream/whip-publisher";

const ACTIVE_PHASES = new Set(["connecting", "confirming", "live", "reconnecting"]);
const MAX_RECONNECT_ATTEMPTS = 8;
const TWITCH_CONFIRMATION_MS = 45_000;

function studioMessageForError(error) {
  if (error?.name === "NotAllowedError") return "Camera or microphone permission was denied. Allow both, then try again.";
  if (error?.name === "NotFoundError") return "No camera or microphone is available on this device.";
  if (error?.name === "NotReadableError") return "The camera or microphone is already in use by another app.";
  return error?.message || "The live studio could not start.";
}

const panelStyle = {
  marginTop: 16,
  padding: 14,
  border: "1px solid rgba(0,255,255,.18)",
  borderRadius: 12,
  background: "linear-gradient(145deg,rgba(0,255,255,.045),rgba(145,70,255,.05))",
};

const buttonBase = {
  borderRadius: 8,
  padding: "8px 13px",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
};

const selectStyle = {
  width: "100%",
  minWidth: 0,
  background: "#0b0b0b",
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 8,
  color: "white",
  padding: "8px 10px",
  fontSize: 11,
};

function BrowserBroadcastStudio({ defaultTitle = "2MRRW Live", audience = "all" }) {
  const { refreshLiveState } = useLiveBroadcast();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const publisherRef = useRef(null);
  const generationRef = useRef(0);
  const manualStopRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const confirmTimerRef = useRef(null);
  const twitchPollTimerRef = useRef(null);
  const twitchPollRef = useRef(null);
  const twitchPopupRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const connectRef = useRef(null);

  const [phase, setPhase] = useState("idle");
  const [message, setMessage] = useState("Preview your camera, then go live directly from 2MRRW.");
  const [devices, setDevices] = useState({ cameras: [], microphones: [] });
  const [hasMedia, setHasMedia] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMicrophone, setSelectedMicrophone] = useState("");
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [twitchAuthorization, setTwitchAuthorization] = useState({ status: "checking", broadcasterLogin: null });
  const [twitchPrompt, setTwitchPrompt] = useState(null);
  const [adminVerificationRequired, setAdminVerificationRequired] = useState(false);

  const clearTimers = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    clearTimeout(confirmTimerRef.current);
    clearTimeout(twitchPollTimerRef.current);
    reconnectTimerRef.current = null;
    confirmTimerRef.current = null;
    twitchPollTimerRef.current = null;
  }, []);

  useEffect(() => {
    let current = true;
    fetch("/api/admin/twitch/authorization", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!current) return;
        if (RECOVERABLE_ADMIN_AUTH_CODES.has(data.code)) setAdminVerificationRequired(true);
        setTwitchAuthorization({
          status: response.ok && data.connected ? "connected" : response.ok ? "required" : "error",
          broadcasterLogin: data.broadcasterLogin || null,
        });
      })
      .catch(() => {
        if (current) setTwitchAuthorization({ status: "error", broadcasterLogin: null });
      });
    return () => { current = false; };
  }, []);

  const pollTwitchAuthorization = useCallback((prompt, delaySeconds = prompt.intervalSeconds) => {
    clearTimeout(twitchPollTimerRef.current);
    twitchPollTimerRef.current = window.setTimeout(async () => {
      twitchPollTimerRef.current = null;
      try {
        const response = await fetch("/api/admin/twitch/authorization", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grantToken: prompt.grantToken }),
          cache: "no-store",
        });
        const data = await response.json();
        if (response.status === 202) {
          twitchPollRef.current?.(prompt, data.slowDown ? delaySeconds + 5 : delaySeconds);
          return;
        }
        if (!response.ok) throw new Error(data.error || "Twitch authorization failed");
        setTwitchAuthorization({
          status: "connected",
          broadcasterLogin: data.authorization?.broadcaster_login || null,
        });
        setTwitchPrompt(null);
        setMessage("Twitch authorized. You can go live immediately.");
        twitchPopupRef.current?.close();
        twitchPopupRef.current = null;
      } catch (error) {
        setTwitchAuthorization({ status: "error", broadcasterLogin: null });
        setMessage(studioMessageForError(error));
      }
    }, Math.max(2, delaySeconds) * 1000);
  }, []);

  useEffect(() => {
    twitchPollRef.current = pollTwitchAuthorization;
  }, [pollTwitchAuthorization]);

  const authorizeTwitch = useCallback(async () => {
    if (twitchAuthorization.status === "authorizing") return;
    // Open synchronously from the click so browser popup protection does not
    // block Twitch. If it still does, the same destination is rendered as a link.
    twitchPopupRef.current = window.open("about:blank", "2mrrw-twitch-authorization", "popup,width=760,height=760");
    setTwitchAuthorization({ status: "authorizing", broadcasterLogin: null });
    setMessage("Preparing secure Twitch sign-in…");
    try {
      const response = await fetch("/api/admin/twitch/authorization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        if (RECOVERABLE_ADMIN_AUTH_CODES.has(data.code)) setAdminVerificationRequired(true);
        throw new Error(data.error || "Twitch authorization could not start");
      }
      const prompt = {
        grantToken: data.grantToken,
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        intervalSeconds: data.intervalSeconds,
      };
      setTwitchPrompt(prompt);
      setMessage("Finish signing in on Twitch. This studio will connect automatically when you approve.");
      if (twitchPopupRef.current && !twitchPopupRef.current.closed) {
        twitchPopupRef.current.opener = null;
        twitchPopupRef.current.location.href = prompt.verificationUri;
      }
      pollTwitchAuthorization(prompt);
    } catch (error) {
      twitchPopupRef.current?.close();
      twitchPopupRef.current = null;
      setTwitchAuthorization({ status: "error", broadcasterLogin: null });
      setMessage(studioMessageForError(error));
    }
  }, [pollTwitchAuthorization, twitchAuthorization.status]);

  const enumerateDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const cameras = all.filter((device) => device.kind === "videoinput");
    const microphones = all.filter((device) => device.kind === "audioinput");
    setDevices({ cameras, microphones });
    setSelectedCamera((current) => current || cameras[0]?.deviceId || "");
    setSelectedMicrophone((current) => current || microphones[0]?.deviceId || "");
  }, []);

  const attachStream = useCallback((stream) => {
    streamRef.current = stream;
    setHasMedia(true);
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const acquireMedia = useCallback(async ({ cameraId = selectedCamera, microphoneId = selectedMicrophone } = {}) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support live camera publishing.");
    const next = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraId ? { exact: cameraId } : undefined,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: {
        deviceId: microphoneId ? { exact: microphoneId } : undefined,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48_000 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    next.getVideoTracks().forEach((track) => { track.enabled = cameraEnabled; });
    next.getAudioTracks().forEach((track) => { track.enabled = microphoneEnabled; });
    const previous = streamRef.current;
    attachStream(next);
    previous?.getTracks().forEach((track) => track.stop());
    await enumerateDevices();
    return next;
  }, [attachStream, cameraEnabled, enumerateDevices, microphoneEnabled, selectedCamera, selectedMicrophone]);

  const ensureMedia = useCallback(async () => {
    const current = streamRef.current;
    if (current?.getTracks().some((track) => track.readyState === "live")) return current;
    return acquireMedia();
  }, [acquireMedia]);

  const startPreview = useCallback(async () => {
    if (ACTIVE_PHASES.has(phase)) return;
    setPhase("preparing");
    setMessage("Opening camera and microphone…");
    try {
      await acquireMedia();
      setPhase("preview");
      setMessage("Preview ready. Twitch does not receive anything until you press Go Live Now.");
    } catch (error) {
      setPhase("error");
      setMessage(studioMessageForError(error));
    }
  }, [acquireMedia, phase]);

  const beginTwitchConfirmation = useCallback((generation) => {
    const deadline = Date.now() + TWITCH_CONFIRMATION_MS;
    const check = async () => {
      if (generation !== generationRef.current || manualStopRef.current) return;
      try {
        // Reconcile through the existing provider-authority route. This both
        // checks Twitch and atomically promotes the pending broadcast, so the
        // mounted fan/player surfaces see provider truth on the same cycle.
        const response = await fetch("/api/admin/livestream", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync" }),
          cache: "no-store",
        });
        const data = await response.json();
        if (response.ok && data.providerStatus === "live") {
          reconnectAttemptsRef.current = 0;
          setPhase("live");
          setMessage("Twitch confirmed the ingest. You are live on 2MRRW now.");
          refreshLiveState();
          return;
        }
      } catch { /* EventSub remains authoritative; keep confirming. */ }

      if (Date.now() < deadline) {
        confirmTimerRef.current = window.setTimeout(check, 1000);
      } else {
        setPhase("confirming");
        setMessage("The relay is broadcasting. Twitch confirmation is delayed; keep this studio open.");
        refreshLiveState();
      }
    };
    check();
  }, [refreshLiveState]);

  const scheduleReconnect = useCallback((generation, error) => {
    if (manualStopRef.current || generation !== generationRef.current || reconnectTimerRef.current) return;
    const attempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = attempt;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      setPhase("error");
      setMessage(`The relay connection could not recover. ${studioMessageForError(error)}`);
      return;
    }
    const delay = Math.min(8000, 750 * (2 ** (attempt - 1)));
    setPhase("reconnecting");
    setMessage(`Connection interrupted. Recovering automatically (${attempt}/${MAX_RECONNECT_ATTEMPTS})…`);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current?.(true);
    }, delay);
  }, []);

  const connectPublisher = useCallback(async (recovery = false) => {
    if (twitchAuthorization.status !== "connected") {
      setMessage("Authorize Twitch first, then Go Live Now will be ready.");
      return;
    }
    manualStopRef.current = false;
    clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (!recovery) reconnectAttemptsRef.current = 0;
    setPhase(recovery ? "reconnecting" : "connecting");
    setMessage(recovery ? "Re-establishing the secure relay…" : "Connecting securely to the live relay…");

    try {
      const stream = await ensureMedia();
      const sessionResponse = await fetch("/api/admin/livestream/studio/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: defaultTitle, audience }),
      });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok) {
        if (session.code === "TWITCH_AUTHORIZATION_REQUIRED") {
          setTwitchAuthorization({ status: "required", broadcasterLogin: null });
          setPhase(hasMedia ? "preview" : "idle");
          setMessage("Twitch needs authorization again. Use the sign-in link, then Go Live Now.");
          return;
        }
        throw new Error(session.error || `Studio session failed (${sessionResponse.status})`);
      }
      if (generation !== generationRef.current || manualStopRef.current) return;

      publisherRef.current?.close();
      const publisher = new WhipPublisher({
        url: session.publishUrl,
        token: session.publishToken,
        stream,
        onStateChange: (state, error) => {
          if (generation !== generationRef.current || manualStopRef.current) return;
          if (state === "connected") {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
            setPhase("confirming");
            setMessage("Relay connected. Waiting for Twitch ingest confirmation…");
            beginTwitchConfirmation(generation);
          } else if (state === "failed" || state === "closed") {
            scheduleReconnect(generation, error);
          } else if (state === "disconnected" && !reconnectTimerRef.current) {
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              scheduleReconnect(generation, error || new Error("Peer connection disconnected"));
            }, 2500);
          }
        },
      });
      publisherRef.current = publisher;
      await publisher.connect();
    } catch (error) {
      if (generation === generationRef.current && !manualStopRef.current) {
        scheduleReconnect(generation, error);
      }
    }
  }, [audience, beginTwitchConfirmation, defaultTitle, ensureMedia, hasMedia, scheduleReconnect, twitchAuthorization.status]);

  useEffect(() => {
    connectRef.current = connectPublisher;
  }, [connectPublisher]);

  const stopBroadcast = useCallback(() => {
    manualStopRef.current = true;
    generationRef.current += 1;
    clearTimers();
    publisherRef.current?.close();
    publisherRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setHasMedia(false);
    if (videoRef.current) videoRef.current.srcObject = null;
    setPhase("idle");
    setMessage("Broadcast ended. Twitch will confirm offline automatically.");
    window.setTimeout(refreshLiveState, 2500);
  }, [clearTimers, refreshLiveState]);

  const changeDevice = useCallback(async (kind, deviceId) => {
    if (kind === "camera") setSelectedCamera(deviceId);
    else setSelectedMicrophone(deviceId);
    if (!streamRef.current || ACTIVE_PHASES.has(phase)) return;
    setPhase("preparing");
    try {
      // Release the old capture before asking macOS/iOS for a different device;
      // several camera drivers reject two concurrent opens from one document.
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setHasMedia(false);
      if (videoRef.current) videoRef.current.srcObject = null;
      await acquireMedia({
        cameraId: kind === "camera" ? deviceId : selectedCamera,
        microphoneId: kind === "microphone" ? deviceId : selectedMicrophone,
      });
      setPhase("preview");
      setMessage("Preview updated.");
    } catch (error) {
      setPhase("error");
      setMessage(studioMessageForError(error));
    }
  }, [acquireMedia, phase, selectedCamera, selectedMicrophone]);

  const toggleTrack = useCallback((kind) => {
    const tracks = kind === "video" ? streamRef.current?.getVideoTracks() : streamRef.current?.getAudioTracks();
    const nextEnabled = !(tracks?.[0]?.enabled ?? true);
    tracks?.forEach((track) => { track.enabled = nextEnabled; });
    if (kind === "video") setCameraEnabled(nextEnabled);
    else setMicrophoneEnabled(nextEnabled);
  }, []);

  useEffect(() => () => {
    manualStopRef.current = true;
    generationRef.current += 1;
    clearTimers();
    publisherRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    twitchPopupRef.current = null;
  }, [clearTimers]);

  const active = ACTIVE_PHASES.has(phase);
  const busy = phase === "preparing" || phase === "connecting" || phase === "reconnecting";
  const statusColor = phase === "live" ? "#22c55e" : phase === "error" ? "#ef4444" : active ? "#00ffff" : "rgba(255,255,255,.45)";

  return (
    <section data-browser-broadcast-studio style={panelStyle} aria-label="Browser broadcast studio">
      {adminVerificationRequired && (
        <AdminVerificationOverlay
          onCancel={() => setAdminVerificationRequired(false)}
          onVerified={async () => {
            setAdminVerificationRequired(false);
            setTwitchAuthorization({ status: "required", broadcasterLogin: null });
            await authorizeTwitch();
          }}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", color: "#00ffff" }}>2MRRW BROADCAST STUDIO</div>
        <div role="status" aria-live="polite" style={{ fontSize: 9, letterSpacing: ".12em", color: statusColor, textTransform: "uppercase" }}>{phase}</div>
      </div>

      <div style={{ position: "relative", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: 10, background: "#020202", border: "1px solid rgba(255,255,255,.08)" }}>
        <video ref={videoRef} muted autoPlay playsInline style={{ width: "100%", height: "100%", display: "block", objectFit: "cover", background: "#020202" }} />
        {!hasMedia && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,.25)", fontSize: 11, letterSpacing: ".12em" }}>CAMERA PREVIEW</div>}
        {phase === "live" && <div style={{ position: "absolute", top: 10, left: 10, padding: "5px 8px", borderRadius: 6, background: "rgba(220,38,38,.92)", color: "white", fontSize: 10, fontWeight: 900, letterSpacing: ".12em" }}>LIVE</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8, marginTop: 10 }}>
        <label style={{ fontSize: 9, color: "rgba(255,255,255,.4)", letterSpacing: ".1em" }}>CAMERA
          <select value={selectedCamera} onChange={(event) => changeDevice("camera", event.target.value)} disabled={active} style={{ ...selectStyle, marginTop: 5, opacity: active ? .55 : 1 }}>
            {devices.cameras.length === 0 && <option value="">Default camera</option>}
            {devices.cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 9, color: "rgba(255,255,255,.4)", letterSpacing: ".1em" }}>MICROPHONE
          <select value={selectedMicrophone} onChange={(event) => changeDevice("microphone", event.target.value)} disabled={active} style={{ ...selectStyle, marginTop: 5, opacity: active ? .55 : 1 }}>
            {devices.microphones.length === 0 && <option value="">Default microphone</option>}
            {devices.microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
          </select>
        </label>
      </div>

      <div style={{ fontSize: 10, color: statusColor, lineHeight: 1.5, margin: "10px 0" }}>{message}</div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 9, letterSpacing: ".1em", color: twitchAuthorization.status === "connected" ? "#22c55e" : "rgba(255,255,255,.42)" }}>
          TWITCH {twitchAuthorization.status === "connected" ? `AUTHORIZED${twitchAuthorization.broadcasterLogin ? ` · @${twitchAuthorization.broadcasterLogin}` : ""}` : twitchAuthorization.status === "authorizing" ? "WAITING FOR APPROVAL" : twitchAuthorization.status === "checking" ? "CHECKING" : "AUTHORIZATION REQUIRED"}
        </span>
        {twitchAuthorization.status !== "connected" && (
          <button type="button" onClick={authorizeTwitch} disabled={twitchAuthorization.status === "authorizing"} style={{ ...buttonBase, padding: "6px 10px", background: "#9146ff", color: "white", border: "1px solid #a970ff", opacity: twitchAuthorization.status === "authorizing" ? .65 : 1 }}>
            {twitchAuthorization.status === "authorizing" ? "Waiting for Twitch…" : "Authorize Twitch"}
          </button>
        )}
        {twitchPrompt?.verificationUri && (
          <a href={twitchPrompt.verificationUri} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#bf94ff", textDecoration: "underline" }}>
            Open Twitch sign-in{twitchPrompt.userCode ? ` · code ${twitchPrompt.userCode}` : ""}
          </a>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {!active && <button type="button" onClick={startPreview} disabled={busy} style={{ ...buttonBase, background: "transparent", color: "#c7c7c7", border: "1px solid rgba(255,255,255,.18)", opacity: busy ? .55 : 1 }}>{hasMedia ? "Refresh Preview" : "Preview Camera"}</button>}
        {!active && <button type="button" onClick={() => connectPublisher(false)} disabled={busy || twitchAuthorization.status !== "connected"} style={{ ...buttonBase, background: "#00ffff", color: "#000", border: "1px solid #00ffff", opacity: busy || twitchAuthorization.status !== "connected" ? .45 : 1 }}>{busy ? "Connecting…" : "Go Live Now"}</button>}
        {active && <button type="button" onClick={stopBroadcast} style={{ ...buttonBase, background: "rgba(239,68,68,.16)", color: "#ff6b6b", border: "1px solid rgba(239,68,68,.45)" }}>End Broadcast</button>}
        {hasMedia && <button type="button" onClick={() => toggleTrack("video")} style={{ ...buttonBase, background: "transparent", color: cameraEnabled ? "#aaa" : "#f59e0b", border: "1px solid rgba(255,255,255,.12)" }}>{cameraEnabled ? "Camera On" : "Camera Off"}</button>}
        {hasMedia && <button type="button" onClick={() => toggleTrack("audio")} style={{ ...buttonBase, background: "transparent", color: microphoneEnabled ? "#aaa" : "#f59e0b", border: "1px solid rgba(255,255,255,.12)" }}>{microphoneEnabled ? "Mic On" : "Mic Muted"}</button>}
      </div>
      <div style={{ marginTop: 9, fontSize: 9, color: "rgba(255,255,255,.25)", lineHeight: 1.5 }}>Twitch authorization and the stream key stay server-side and are never sent to this browser. Keep this tab open while broadcasting.</div>
    </section>
  );
}

export default memo(BrowserBroadcastStudio);
