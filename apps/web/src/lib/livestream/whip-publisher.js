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

async function configureSender(sender, kind) {
  if (!sender?.getParameters || !sender?.setParameters) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = kind === "video" ? 6_000_000 : 160_000;
  if (kind === "video") params.degradationPreference = "maintain-framerate";
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
    const answer = await response.text();
    await peer.setRemoteDescription({ type: "answer", sdp: answer });

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
      if (!this.closed && error?.name !== "AbortError") this.onStateChange?.("failed", error);
    });
  }

  async patchCandidates(candidates) {
    if (!this.sessionUrl || this.closed) return;
    const response = await fetch(this.sessionUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/trickle-ice-sdpfrag",
        "If-Match": "*",
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
    this.abortController.abort();
    this.peer?.close();
    this.peer = null;
    if (sessionUrl) {
      fetch(sessionUrl, { method: "DELETE", keepalive: true }).catch(() => {});
    }
  }
}
