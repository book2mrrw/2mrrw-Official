import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {measureEncryptedTsPeak} from '../audio-headroom.js';
import {encryptSegmentBuffer} from '../engine/packaging.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encrypted-audio-test-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const key = crypto.randomBytes(16), iv = crypto.randomBytes(16);
  const plain = [Buffer.from('first transport segment'), Buffer.from('second transport segment')];
  const segments = plain.map((bytes, index) => {
    const file = path.join(dir, `${index}.ts`);
    fs.writeFileSync(file, encryptSegmentBuffer(bytes, key, iv));
    return file;
  });
  return {key, iv, plain, segments, verificationPath: path.join(dir, 'verify.ts')};
}

test('independently decrypts padded segments, explicitly selects TS and preserves ciphertext', async t => {
  const f = fixture(t), before = f.segments.map(file => fs.readFileSync(file));
  const peak = await measureEncryptedTsPeak(f.segments, {...f, measure: async (file, options) => {
    assert.deepEqual(fs.readFileSync(file), Buffer.concat(f.plain));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(options, {transportStream: true});
    return -Infinity;
  }});
  assert.equal(peak, -Infinity);
  assert.ok(!fs.existsSync(f.verificationPath));
  assert.deepEqual(f.segments.map(file => fs.readFileSync(file)), before);
});

test('invalid ciphertext fails before measurement and deletes partial private bytes', async t => {
  const f = fixture(t);
  fs.truncateSync(f.segments[1], fs.statSync(f.segments[1]).size - 1);
  let measured = false;
  await assert.rejects(measureEncryptedTsPeak(f.segments, {...f, measure: async () => {measured = true;}}));
  assert.equal(measured, false);
  assert.ok(!fs.existsSync(f.verificationPath));
});

test('decoder rejection still removes verification bytes', async t => {
  const f = fixture(t);
  await assert.rejects(measureEncryptedTsPeak(f.segments, {...f, measure: async () => {throw Error('decoder failed');}}), /decoder failed/);
  assert.ok(!fs.existsSync(f.verificationPath));
});

test('existing output is not overwritten or deleted and empty output cannot qualify', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.verificationPath, 'sentinel');
  await assert.rejects(measureEncryptedTsPeak(f.segments, f), /EEXIST/);
  assert.equal(fs.readFileSync(f.verificationPath, 'utf8'), 'sentinel');
  await assert.rejects(measureEncryptedTsPeak([], f), /No encrypted audio/);
});
