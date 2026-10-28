import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as policy from '../../../../workers/hls-transcoder/src/audio-headroom.js';
let encodes, decoded, alwaysUnsafe;
// The old pre-encode-only path can complete too; a baseline failure must
// demonstrate the missing publication gate, not a missing local FFmpeg binary.
mock.module('child_process', { namedExports: { spawn: () => {
  const child = new EventEmitter(); child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit('close', 0)); return child;
} } });
mock.module('../../../../workers/hls-transcoder/src/audio-headroom.js', { namedExports: { ...policy,
  runAudioFfmpeg: async args => { encodes.push(args); },
  measureTruePeak: async path => path === 'input.wav' ? 2 : (++decoded === 1 || alwaysUnsafe ? 0.5 : -2),
} });
const { transcodeMasterToStreamFile } = await import('../stream-transcode.js');
beforeEach(() => { encodes = []; decoded = 0; alwaysUnsafe = false; });
test('AAC reconstruction overshoot triggers a measured retry before a progressive file qualifies', async () => {
  const result = await transcodeMasterToStreamFile('input.wav', 'output.m4a');
  assert.equal(encodes.length, 2);
  assert.equal(decoded, 2);
  assert.equal(result.decodedPeak, -2);
  assert.notEqual(encodes[0][encodes[0].indexOf('-af') + 1], encodes[1][encodes[1].indexOf('-af') + 1]);
  for (const args of encodes) {
    assert.equal(args[args.indexOf('-ar') + 1], '44100');
    assert.match(args[args.indexOf('-af') + 1], /^volume=.*:precision=double$/);
  }
});
test('persistent codec overshoot exhausts a finite budget and cannot return publishable success', async () => {
  alwaysUnsafe = true;
  await assert.rejects(transcodeMasterToStreamFile('input.wav', 'output.m4a'), /decoded true-peak ceiling/);
  assert.equal(encodes.length, policy.MAX_HEADROOM_PASSES);
});
