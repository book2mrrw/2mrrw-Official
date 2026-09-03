"use client";

/**
 * Derive a short preview clip from an in-memory master audio File, entirely
 * in the browser — no server round trip, no ffmpeg, no extra dependency.
 * Used by the admin upload wizard so a preview never requires a separate
 * manual file: the admin picks a start point on the already-selected
 * master, and this produces the actual clip to upload.
 */
export async function extractAudioClipAsWav(file, { startSeconds = 0, durationSeconds = 15 } = {}) {
  if (!(file instanceof Blob)) throw new TypeError("extractAudioClipAsWav requires a File or Blob");
  if (startSeconds < 0 || !Number.isFinite(startSeconds)) {
    throw new Error("Invalid preview start time");
  }

  const arrayBuffer = await file.arrayBuffer();
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("This browser cannot decode audio for preview generation");
  const ctx = new AudioContextCtor();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close().catch(() => {});
  }

  const sampleRate = decoded.sampleRate;
  const startSample = Math.floor(startSeconds * sampleRate);
  if (startSample >= decoded.length) {
    throw new Error("Preview start time is at or past the end of the track");
  }
  const requestedSamples = Math.floor(durationSeconds * sampleRate);
  const availableSamples = decoded.length - startSample;
  const clipSamples = Math.min(requestedSamples, availableSamples);
  if (clipSamples <= 0) {
    throw new Error("Preview start time is at or past the end of the track");
  }

  const numChannels = decoded.numberOfChannels;
  const clipChannels = [];
  for (let c = 0; c < numChannels; c++) {
    clipChannels.push(decoded.getChannelData(c).subarray(startSample, startSample + clipSamples));
  }

  return {
    blob: encodeWav(clipChannels, sampleRate),
    actualDurationSeconds: clipSamples / sampleRate,
    truncated: clipSamples < requestedSamples,
  };
}

/** Minimal, dependency-free 16-bit PCM WAV encoder. */
function encodeWav(channelData, sampleRate) {
  const numChannels = channelData.length;
  const numSamples = channelData[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Cheap duration probe via <audio> metadata — avoids a full decode just to size a slider. */
export function probeAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const duration = el.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read audio duration"));
    };
    el.src = url;
  });
}
