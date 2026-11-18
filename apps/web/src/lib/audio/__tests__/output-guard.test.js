import assert from "node:assert/strict";
import test from "node:test";

import { createOutputGuardKernel, loadOutputGuard, OUTPUT_GUARD_PROCESSOR } from "../output-guard.js";

const SR = 48000;
const ms = (n) => Math.round((n * SR) / 1000);

function run(inL, inR = inL, block = 128) {
  const kernel = createOutputGuardKernel(SR);
  const outL = new Float32Array(inL.length);
  const outR = new Float32Array(inL.length);
  for (let i = 0; i < inL.length; i += block) {
    const n = Math.min(block, inL.length - i);
    kernel.process(inL?.subarray(i, i + n) ?? null, inR?.subarray(i, i + n) ?? null, outL.subarray(i, i + n), outR.subarray(i, i + n), n);
  }
  return { kernel, outL, outR, delay: kernel.latencyFrames };
}

const tone = (frames, amp, hz = 220, phase = 0) =>
  Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR + phase));
const join = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const silence = (frames) => new Float32Array(frames);
const largestStep = (y) => { let m = 0; for (let i = 1; i < y.length; i += 1) m = Math.max(m, Math.abs(y[i] - y[i - 1])); return m; };
const peak = (y, from, to) => { let m = 0; for (let i = Math.max(0, from); i < to; i += 1) m = Math.max(m, Math.abs(y[i])); return m; };
// A 220 Hz tone at 0.5 moves at most ~0.0144 per sample; a click is a jump far beyond that.
const STEADY_STEP = 2 * Math.PI * 220 * 0.5 / SR;

test("music passes bit-exact once the opening fade-in is done", () => {
  const input = tone(SR, 0.5);
  const { outL, outR, delay, kernel } = run(input);
  for (let i = delay + kernel.fadeInFrames + 1; i < input.length; i += 1) {
    assert.equal(outL[i], input[i - delay]);
    assert.equal(outR[i], input[i - delay]);
  }
});

test("a cut to silence (pause, underrun, skip) fades out before it is heard", () => {
  const cut = ms(500);
  for (const phase of [0, Math.PI / 2]) {
    const input = join(tone(cut, 0.5, 220, phase), silence(ms(200)));
    const { outL, delay } = run(input);
    const arrives = cut + delay;
    assert.ok(Math.abs(input[cut - 1]) > 0.01 || phase === 0, "the unguarded cut is a jump");
    assert.ok(peak(outL, arrives - ms(1), arrives) < 0.03, "last millisecond before silence is near zero");
    assert.ok(Math.abs(outL[arrives - 1]) < 1e-4, "faded fully out when the cut arrives");
    assert.ok(largestStep(outL) <= STEADY_STEP + 0.002, `largest step ${largestStep(outL)}`);
  }
});

test("sound returning after silence fades in, even when it returns at full level", () => {
  const input = join(silence(ms(100)), tone(ms(300), 0.5, 220, Math.PI / 2));
  const { outL, delay } = run(input);
  const returns = ms(100) + delay;
  assert.equal(Math.abs(input[ms(100)]), 0.5, "the unguarded return is a jump");
  assert.ok(peak(outL, returns, returns + ms(1)) < 0.03);
  assert.ok(largestStep(outL) <= STEADY_STEP + 0.002, `largest step ${largestStep(outL)}`);
});

test("a stuttering connection — dropouts closer together than the lookahead — stays continuous", () => {
  const parts = [];
  for (let i = 0; i < 20; i += 1) parts.push(tone(240 + (i % 3) * 70, 0.5, 220, i), silence(60 + (i % 4) * 40));
  const { outL } = run(join(...parts));
  assert.ok(largestStep(outL) <= STEADY_STEP + 0.01, `largest step ${largestStep(outL)}`);
});

test("brief exact zeros inside music are left alone", () => {
  const input = tone(ms(300), 0.5);
  input.fill(0, ms(150), ms(150) + 20);
  const { outL, delay, kernel } = run(input);
  for (let i = delay + kernel.fadeInFrames + 1; i < input.length; i += 1) assert.equal(outL[i], input[i - delay]);
});

test("peaks over −1 dBFS are limited smoothly, never clipped, and the master returns untouched", () => {
  const loud = tone(ms(500), 2, 110);
  const after = tone(ms(1500), 0.5, 110);
  const input = join(loud, after);
  const { outL, delay, kernel } = run(input);
  assert.ok(peak(outL, 0, outL.length) <= kernel.ceiling + 1e-6, `peak ${peak(outL, 0, outL.length)}`);
  let gainStep = 0;
  let previous = null;
  for (let i = delay + kernel.fadeInFrames; i < input.length; i += 1) {
    const x = input[i - delay];
    if (Math.abs(x) < 0.05) { previous = null; continue; }
    const gain = outL[i] / x;
    if (previous !== null) gainStep = Math.max(gainStep, Math.abs(gain - previous));
    previous = gain;
  }
  assert.ok(gainStep < 0.01, `gain moved ${gainStep} in one sample`);
  for (let i = input.length - ms(300); i < input.length; i += 1) assert.equal(outL[i], input[i - delay]);
});

test("no input (an idle element) is silence, and the next sound fades in", () => {
  const kernel = createOutputGuardKernel(SR);
  const out = new Float32Array(128);
  kernel.process(null, null, out, null, 128);
  assert.ok(out.every((v) => v === 0));
  const input = tone(ms(50), 0.5, 220, Math.PI / 2);
  const outL = new Float32Array(input.length);
  kernel.process(input, input, outL, null, input.length);
  assert.ok(largestStep(outL) <= STEADY_STEP + 0.002);
});

test("the render block size never changes the output", () => {
  const parts = [];
  for (let i = 0; i < 12; i += 1) parts.push(tone(400 + i * 37, i % 2 ? 1.6 : 0.5, 180, i), silence(30 + i * 25));
  const input = join(...parts);
  const reference = run(input, input, 128).outL;
  for (const block of [1, 64, 1000]) assert.deepEqual(run(input, input, block).outL, reference);
});

test("the worklet built from the kernel's own source registers and processes", async (t) => {
  let source = null;
  const added = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { source = blob; return "blob:guard"; };
  URL.revokeObjectURL = () => {};
  globalThis.AudioWorkletNode = class {};
  t.after(() => { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; delete globalThis.AudioWorkletNode; });

  const ctx = { audioWorklet: { addModule: async (url) => { added.push(url); } } };
  assert.equal(await loadOutputGuard(ctx), true);
  assert.equal(await loadOutputGuard(ctx), true);
  assert.deepEqual(added, ["blob:guard"], "one module per context");
  assert.equal(await loadOutputGuard({}), false, "no AudioWorklet: the caller keeps its stand-in");

  let name = null;
  let Processor = null;
  class AudioWorkletProcessor {}
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", await source.text())(
    AudioWorkletProcessor, (n, cls) => { name = n; Processor = cls; }, SR);
  assert.equal(name, OUTPUT_GUARD_PROCESSOR);
  const processor = new Processor();
  const input = tone(128 * 40, 0.5, 220, Math.PI / 2);
  const expected = run(input).outL;
  const actual = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    const block = input.subarray(i, i + 128);
    const out = [new Float32Array(128), new Float32Array(128)];
    assert.equal(processor.process([[block, block]], [out]), true);
    actual.set(out[0], i);
  }
  assert.deepEqual(actual, expected);
});
