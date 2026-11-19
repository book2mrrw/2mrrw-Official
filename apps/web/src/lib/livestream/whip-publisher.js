function parseIceServers(linkHeader) {
  if (!linkHeader) return [];
  const servers = [];
  for (const value of linkHeader.split(/,\s*(?=<)/)) {
    const url = value.match(/<([^>]+)>/)?.[1];
    if (!url || !/;\s*rel="ice-server"/i.test(value)) continue;
    const server = { urls: [url] };
    const username = value.match(/;\s*username="((?:[^"\\]|\\.)*)"/i)?.[1];
    const credential = value.match(/;\s*credential="((?:[^"\\]|\\.)*)"/i)?.[1];
    if (username !== undefined && credential !== undefined) {
      server.username = JSON.parse(`"${username}"`);
      server.credential = JSON.parse(`"${credential}"`);
      server.credentialType = "password";
    }
    servers.push(server);
  }
  return servers;
}

function parseOfferForTrickle(sdp) {
  const data = { iceUfrag: "", icePwd: "", media: [] };
  for (const line of String(sdp || "").split("\r\n")) {
    if (line.startsWith("m=")) data.media.push(line.slice(2));
    else if (!data.iceUfrag && line.startsWith("a=ice-ufrag:")) data.iceUfrag = line.slice(12);
    else if (!data.icePwd && line.startsWith("a=ice-pwd:")) data.icePwd = line.slice(10);
  }
  return data;
}

function candidateFragment(offer, candidates) {
  const byMedia = new Map();
  for (const candidate of candidates) {
    const index = candidate.sdpMLineIndex;
    if (!Number.isInteger(index)) continue;
    const group = byMedia.get(index) || [];
    group.push(candidate);
    byMedia.set(index, group);
  }
  let fragment = `a=ice-ufrag:${offer.iceUfrag}\r\na=ice-pwd:${offer.icePwd}\r\n`;
  for (const [index, group] of byMedia) {
    if (!offer.media[index]) continue;
    fragment += `m=${offer.media[index]}\r\na=mid:${index}\r\n`;
    for (const candidate of group) fragment += `a=${candidate.candidate}\r\n`;
  }
  return fragment;
}

// H.264 profiles in the order the relay can pass straight to Twitch: High,
// Main, then Constrained Baseline / Baseline (what software encoders offer).
const H264_PROFILE_ORDER = ["64", "4d", "42e0", "42c0", "4200"];

function h264Rank(codec) {
  const profile = /profile-level-id=([0-9a-f]{6})/i.exec(codec.sdpFmtpLine || "")?.[1]?.toLowerCase() || "";
  const index = H264_PROFILE_ORDER.findIndex((prefix) => profile.startsWith(prefix));
  return index === -1 ? H264_PROFILE_ORDER.length : index;
}

/**
 * Ask the browser to encode video as H.264 (packetization-mode 1) when it can,
 * so the relay passes the picture straight to Twitch instead of re-encoding
 * every frame. Every other codec stays in the list as a fallback: a browser
 * without H.264 still publishes, and the relay re-encodes it as before.
 */
export function preferH264(peer, capabilities = globalThis.RTCRtpSender?.getCapabilities?.("video")) {
  const codecs = capabilities?.codecs;
  if (!Array.isArray(codecs) || !peer?.getTransceivers) return false;
  const h264 = codecs
    .filter((codec) => /^video\/h264$/i.test(codec.mimeType) && /packetization-mode=1/.test(codec.sdpFmtpLine || ""))
    .sort((a, b) => h264Rank(a) - h264Rank(b));
  if (!h264.length) return false;
  const ordered = [...h264, ...codecs.filter((codec) => !h264.includes(codec))];
  let applied = false;
  for (const transceiver of peer.getTransceivers()) {
    if (transceiver.sender?.track?.kind !== "video" || !transceiver.setCodecPreferences) continue;
    try {
      transceiver.setCodecPreferences(ordered);
      applied = true;
    } catch { /* The browser keeps its own codec order. */ }
  }
  return applied;
}

// Chrome otherwise starts a WebRTC stream near 300 kbps and grows the picture
// as its bandwidth estimate rises: start a broadcast at broadcast quality.
const BROADCAST_KBPS = { start: 4000, min: 1000, max: 6000 };
const VIDEO_CODECS = /^(H264|VP8|VP9|AV1)\/90000$/i;

/**
 * The relay's answer with Chrome's bitrate hints on every video codec
 * (x-google-start/min/max-bitrate; other browsers ignore them). Repair
 * streams (rtx) and audio are left as they are.
 */
export function withBroadcastBitrate(sdp, kbps = BROADCAST_KBPS) {
  const lines = String(sdp || "").split("\r\n");
  const videoPayloads = new Set();
  for (const line of lines) {
    const match = /^a=rtpmap:(\d+) (\S+)/.exec(line);
    if (match && VIDEO_CODECS.test(match[2])) videoPayloads.add(match[1]);
  }
  const hint = `x-google-start-bitrate=${kbps.start};x-google-min-bitrate=${kbps.min};x-google-max-bitrate=${kbps.max}`;
  return lines.map((line) => {
    const match = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (!match || !videoPayloads.has(match[1]) || /x-google-start-bitrate/.test(match[2])) return line;
    return `a=fmtp:${match[1]} ${match[2]};${hint}`;
  }).join("\r\n");
}

async function configureSender(sender, kind) {
  if (!sender?.getParameters || !sender?.setParameters) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = kind === "video" ? 6_000_000 : 160_000;
  // A broadcast keeps its picture size; under pressure the frame rate dips
  // instead. A resolution that changes mid-stream reaches Twitch as-is when the
  // relay passes video through (and froze at the first, smallest size when it
  // re-encoded).
  if (kind === "video") params.degradationPreference = "maintain-resolution";
  try { await sender.setParameters(params); } catch { /* Browser keeps its safe defaults. */ }
}

/**
 * Minimal lifecycle-owned WHIP publisher. It mutates only its RTCPeerConnection;
 * the caller owns the MediaStream, so reconnecting never reacquires devices.
 */
export class WhipPublisher {
  constructor({ url, token, stream, onStateChange }) {
    this.url = url;
    this.token = token;
    this.stream = stream;
    this.onStateChange = onStateChange;
    this.peer = null;
    this.sessionUrl = null;
    this.sessionEtag = null;
    this.offerData = null;
    this.queuedCandidates = [];
    this.closed = false;
    this.abortController = new AbortController();
  }

  authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async connect() {
    if (this.closed) throw new Error("Publisher is closed");
    this.onStateChange?.("negotiating");

    const options = await fetch(this.url, {
      method: "OPTIONS",
      headers: this.authHeaders(),
      signal: this.abortController.signal,
      cache: "no-store",
    });
    if (!options.ok) throw new Error(`Relay negotiation failed (${options.status})`);

    const peer = new RTCPeerConnection({
      iceServers: parseIceServers(options.headers.get("Link")),
      sdpSemantics: "unified-plan",
    });
    this.peer = peer;
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      this.onStateChange?.(state);
    };
    peer.onicecandidate = (event) => {
      if (event.candidate) this.sendCandidate(event.candidate);
    };

    const senders = this.stream.getTracks().map((track) => peer.addTrack(track, this.stream));
    await Promise.all(senders.map((sender) => configureSender(sender, sender.track?.kind)));
    preferH264(peer);

    const offer = await peer.createOffer();
    this.offerData = parseOfferForTrickle(offer.sdp);
    await peer.setLocalDescription(offer);

    const response = await fetch(this.url, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/sdp" },
      body: offer.sdp,
      signal: this.abortController.signal,
      cache: "no-store",
    });
    if (response.status !== 201) {
      let detail = "";
      try { detail = (await response.json())?.error || ""; } catch { /* Keep status-only error. */ }
      throw new Error(detail || `Relay rejected the broadcast (${response.status})`);
    }

    const location = response.headers.get("Location");
    if (!location) throw new Error("Relay did not create a WHIP session");
    this.sessionUrl = new URL(location, this.url).toString();
    this.sessionEtag = response.headers.get("ETag");
    const answer = await response.text();
    await peer.setRemoteDescription({ type: "answer", sdp: withBroadcastBitrate(answer) });

    const queued = this.queuedCandidates.splice(0);
    if (queued.length) await this.patchCandidates(queued);
  }

  sendCandidate(candidate) {
    if (this.closed) return;
    if (!this.sessionUrl) {
      this.queuedCandidates.push(candidate);
      return;
    }
    this.patchCandidates([candidate]).catch((error) => {
      // Candidate signaling is ancillary once the peer has a viable route.
      // RTCPeerConnection remains the transport authority and will emit
      // "failed" itself if connectivity is actually lost.
      if (!this.closed && error?.name !== "AbortError") this.onStateChange?.("candidate-error", error);
    });
  }

  async patchCandidates(candidates) {
    if (!this.sessionUrl || this.closed) return;
    // A WHIP server advertises Trickle ICE support with the session ETag.
    // Without it, do not mislabel a normal candidate addition as an ICE restart.
    if (!this.sessionEtag) return;
    const response = await fetch(this.sessionUrl, {
      method: "PATCH",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/trickle-ice-sdpfrag",
        "If-Match": this.sessionEtag,
      },
      body: candidateFragment(this.offerData, candidates),
      signal: this.abortController.signal,
      cache: "no-store",
    });
    if (response.status !== 204) throw new Error(`Relay ICE update failed (${response.status})`);
  }

  async replaceTrack(kind, nextTrack) {
    if (this.closed || !this.peer) throw new Error("Publisher is not connected");
    if (!nextTrack || nextTrack.kind !== kind) throw new Error(`A ${kind} track is required`);
    const sender = this.peer.getSenders().find((candidate) => candidate.track?.kind === kind);
    if (!sender) throw new Error(`The publisher has no ${kind} sender`);
    const previousTrack = sender.track;
    await sender.replaceTrack(nextTrack);
    await configureSender(sender, kind);
    if (previousTrack && previousTrack !== nextTrack) {
      this.stream?.removeTrack?.(previousTrack);
      this.stream?.addTrack?.(nextTrack);
      previousTrack.stop?.();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const sessionUrl = this.sessionUrl;
    this.sessionUrl = null;
    this.sessionEtag = null;
    this.abortController.abort();
    this.peer?.close();
    this.peer = null;
    if (sessionUrl) {
      fetch(sessionUrl, { method: "DELETE", headers: this.authHeaders(), keepalive: true }).catch(() => {});
    }
  }
}
