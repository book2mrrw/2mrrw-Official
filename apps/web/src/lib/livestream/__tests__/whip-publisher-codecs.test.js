import assert from "node:assert/strict";
import test from "node:test";
import { preferH264, withBroadcastBitrate } from "../whip-publisher.js";

// What Chrome's RTCRtpSender.getCapabilities("video") reports, abridged.
const CAPS = { codecs: [
  { mimeType: "video/VP8", clockRate: 90000 },
  { mimeType: "video/rtx", clockRate: 90000, sdpFmtpLine: "apt=96" },
  { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f" },
  { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f" },
  { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f" },
  { mimeType: "video/AV1", clockRate: 90000 },
] };

function fakePeer(kinds) {
  const transceivers = kinds.map((kind) => ({
    sender: { track: { kind } },
    preferences: null,
    setCodecPreferences(list) { this.preferences = list; },
  }));
  return { transceivers, getTransceivers: () => transceivers };
}

const profile = (codec) => /profile-level-id=(\w+)/.exec(codec.sdpFmtpLine || "")?.[1];

test("the studio asks for H.264 (packetization-mode 1, High first) and keeps every other codec as a fallback", () => {
  const peer = fakePeer(["audio", "video"]);
  assert.equal(preferH264(peer, CAPS), true);
  const [audio, video] = peer.transceivers;
  assert.equal(audio.preferences, null, "audio keeps the browser's order");
  assert.deepEqual(video.preferences.slice(0, 2).map(profile), ["640c1f", "42e01f"]);
  assert.equal(video.preferences.length, CAPS.codecs.length, "nothing is dropped");
  assert.ok(video.preferences.slice(2).some((codec) => codec.mimeType === "video/VP8"));
});

test("a browser without usable H.264 publishes with its own codec order", () => {
  const peer = fakePeer(["video"]);
  const noH264 = { codecs: CAPS.codecs.filter((codec) => !/packetization-mode=1/.test(codec.sdpFmtpLine || "")) };
  assert.equal(preferH264(peer, noH264), false);
  assert.equal(preferH264(peer, undefined), false);
  assert.equal(peer.transceivers[0].preferences, null);
});

test("the relay's answer starts the broadcast at broadcast quality: hints on video codecs only, once", () => {
  const sdp = [
    "v=0", "m=video 9 UDP/TLS/RTP/SAVPF 102 103", "a=rtpmap:102 H264/90000",
    "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "a=rtpmap:103 rtx/90000", "a=fmtp:103 apt=102",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=1", "",
  ].join("\r\n");
  const hinted = withBroadcastBitrate(sdp);
  assert.match(hinted, /a=fmtp:102 [^\r]*profile-level-id=42e01f;x-google-start-bitrate=4000;x-google-min-bitrate=1000;x-google-max-bitrate=6000\r\n/);
  assert.match(hinted, /a=fmtp:103 apt=102\r\n/, "the repair stream is untouched");
  assert.match(hinted, /a=fmtp:111 minptime=10;useinbandfec=1\r\n/, "audio is untouched");
  assert.equal(withBroadcastBitrate(hinted), hinted, "applied once");
});
