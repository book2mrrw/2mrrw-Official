/**
 * Output guard — the last stage of the music graph, on the audio thread.
 *
 * Every audible edge of the media element is hard: pause, resume, a seek's
 * re-entry, a skip or source swap, and a network underrun all cut the signal
 * to digital silence (or back) between two samples, which is heard as a click
 * or pop. Measured on a phone, those edges jump 0.09–0.25 in one sample. They
 * have many causes and owners, and an underrun cannot be predicted at all, so
 * the guard fixes them where they all pass: the output.
 *
 * - Edges: the signal is delayed by a short lookahead, so a cut to silence is
 *   seen before it is heard and the remaining audio fades to zero exactly when
 *   the cut arrives; audio returning after silence fades in. Short raised-
 *   cosine fades (~7 ms out, 10 ms in): declicks, not audible fades.
 * - Peaks: a lookahead brickwall limiter at −1 dBFS. Its gain is exactly 1.0
 *   unless a sample would cross the ceiling, so the master passes untouched
 *   (DynamicsCompressorNode added ~0.6 dB of makeup gain to everything).
 *
 * `createOutputGuardKernel` must stay self-contained (no outside references):
 * the worklet is built from its source text.
 */

export const OUTPUT_GUARD_PROCESSOR = "mrrw-output-guard";

export function createOutputGuardKernel(sampleRate) {
  var LOOKAHEAD = Math.max(32, Math.round(0.008 * sampleRate));
  var SILENCE_CONFIRM = Math.max(8, Math.round(0.001 * sampleRate));
  var FADE_OUT = LOOKAHEAD - SILENCE_CONFIRM;
  var FADE_IN = Math.max(16, Math.round(0.01 * sampleRate));
  var SILENT = 1e-6;
  var CEILING = Math.pow(10, -1 / 20);
  var RELEASE = 1 - Math.exp(-1 / (0.08 * sampleRate));
  var WINDOW = LOOKAHEAD + 1;
  var EVENTS = 64;

  var size = 1;
  while (size < WINDOW + 1) size *= 2;
  var mask = size - 1;
  var delayL = new Float32Array(size);
  var delayR = new Float32Array(size);
  var held = new Float64Array(size);
  var dequeIndex = new Float64Array(size);
  var dequeValue = new Float64Array(size);
  var dequeHead = 0;
  var dequeTail = 0;
  var released = 1;
  var heldSum = 0;
  var heldBelow = 0;

  // Edges, in input-sample indices: where each confirmed silence starts (cut)
  // and where sound returns after one (resume). Both are known before the
  // delayed read position reaches them.
  var cuts = new Float64Array(EVENTS);
  var cutHead = 0;
  var cutTail = 0;
  var resumes = new Float64Array(EVENTS);
  var resumeHead = 0;
  var resumeTail = 0;
  var silentRun = SILENCE_CONFIRM;
  var written = 0;

  function edgeGain(read) {
    while (cutTail > cutHead && cuts[cutHead % EVENTS] <= read) cutHead += 1;
    var out = 1;
    if (cutTail > cutHead) {
      var ahead = cuts[cutHead % EVENTS] - read;
      if (ahead <= FADE_OUT) out = 0.5 * (1 - Math.cos((Math.PI * ahead) / (FADE_OUT + 1)));
    }
    while (resumeTail - resumeHead > 1 && resumes[(resumeHead + 1) % EVENTS] <= read) resumeHead += 1;
    if (resumeTail > resumeHead && resumes[resumeHead % EVENTS] <= read) {
      var since = read - resumes[resumeHead % EVENTS] + 1;
      if (since < FADE_IN) out = Math.min(out, 0.5 * (1 - Math.cos((Math.PI * since) / FADE_IN)));
    }
    return out;
  }

  function process(inL, inR, outL, outR, frames) {
    for (var i = 0; i < frames; i += 1) {
      var l = inL ? inL[i] : 0;
      var r = inR ? inR[i] : l;
      var slot = written & mask;
      delayL[slot] = l;
      delayR[slot] = r;

      var peak = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
      if (peak <= SILENT) {
        silentRun += 1;
        if (silentRun === SILENCE_CONFIRM && cutTail - cutHead < EVENTS) {
          cuts[cutTail % EVENTS] = written - SILENCE_CONFIRM + 1;
          cutTail += 1;
        }
      } else {
        if (silentRun >= SILENCE_CONFIRM) {
          if (resumeTail - resumeHead >= EVENTS) resumeHead += 1;
          resumes[resumeTail % EVENTS] = written;
          resumeTail += 1;
        }
        silentRun = 0;
      }

      // Lookahead limiter: sliding minimum of the gain each sample needs,
      // released slowly, then averaged over the window so the gain is already
      // down when a peak is read and never steps.
      var need = peak > CEILING ? CEILING / peak : 1;
      while (dequeTail > dequeHead && dequeValue[(dequeTail - 1) & mask] >= need) dequeTail -= 1;
      dequeIndex[dequeTail & mask] = written;
      dequeValue[dequeTail & mask] = need;
      dequeTail += 1;
      while (dequeIndex[dequeHead & mask] <= written - WINDOW) dequeHead += 1;
      var lowest = dequeValue[dequeHead & mask];
      released = lowest < released ? lowest : released + (lowest - released) * RELEASE;
      if (released > 0.999999) released = 1;
      if (written >= WINDOW) {
        var oldest = held[(written - WINDOW) & mask];
        heldSum -= oldest;
        if (oldest < 1) heldBelow -= 1;
      }
      held[written & mask] = released;
      heldSum += released;
      if (released < 1) heldBelow += 1;
      var span = written + 1 < WINDOW ? written + 1 : WINDOW;
      if (heldBelow === 0) heldSum = span;
      var limit = heldBelow > 0 ? Math.min(1, heldSum / span) : 1;

      var read = written - LOOKAHEAD;
      var y0 = 0;
      var y1 = 0;
      if (read >= 0) {
        var gain = limit * edgeGain(read);
        y0 = delayL[read & mask] * gain;
        y1 = delayR[read & mask] * gain;
      }
      outL[i] = y0 > 1 ? 1 : y0 < -1 ? -1 : y0;
      if (outR) outR[i] = y1 > 1 ? 1 : y1 < -1 ? -1 : y1;
      written += 1;
    }
  }

  return { process: process, latencyFrames: LOOKAHEAD, fadeOutFrames: FADE_OUT, fadeInFrames: FADE_IN, ceiling: CEILING };
}

const WORKLET_SOURCE = `const createOutputGuardKernel = ${createOutputGuardKernel.toString()};
class OutputGuardProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernel = createOutputGuardKernel(sampleRate);
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    this.kernel.process(input[0] || null, input[1] || input[0] || null, output[0], output[1] || null, output[0].length);
    return true;
  }
}
registerProcessor(${JSON.stringify(OUTPUT_GUARD_PROCESSOR)}, OutputGuardProcessor);
`;

const modules = new WeakMap();

/** Load the guard's worklet into `ctx` once; resolves false where unsupported. */
export function loadOutputGuard(ctx) {
  if (!ctx?.audioWorklet || typeof AudioWorkletNode === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
    return Promise.resolve(false);
  }
  let loading = modules.get(ctx);
  if (!loading) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    loading = ctx.audioWorklet.addModule(url).then(() => true, () => false);
    loading.then(() => URL.revokeObjectURL(url));
    modules.set(ctx, loading);
  }
  return loading;
}

export function createOutputGuardNode(ctx) {
  return new AudioWorkletNode(ctx, OUTPUT_GUARD_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
}
