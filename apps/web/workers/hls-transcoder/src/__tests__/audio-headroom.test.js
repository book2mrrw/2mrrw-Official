import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTruePeak,initialHeadroomGain,nextHeadroomGain,runAudioFfmpeg} from '../audio-headroom.js';
test('headroom is attenuation-only, shared policy uses worst rendition and rounded safety margin',()=>{
 assert.equal(initialHeadroomGain(0.6),-2.6);
 assert.equal(initialHeadroomGain(-8),0);
 assert.equal(initialHeadroomGain(-Infinity),0);
 assert.equal(nextHeadroomGain(-2.6,[-2,-1.1]),null);
 assert.ok(nextHeadroomGain(-2.6,[-2,0.5]) < -4);
 assert.notEqual(nextHeadroomGain(-2.6,[-1]),null);
 assert.throws(()=>nextHeadroomGain(0,[NaN]));
});
test('measurement requires a complete true-peak summary, permits digital silence',()=>{
 assert.equal(parseTruePeak('Summary:\nTrue peak:\n Peak: 0.6 dBFS'),0.6);
 assert.equal(parseTruePeak('Summary:\nTrue peak:\n Peak: -inf dBFS'),-Infinity);
 assert.throws(()=>parseTruePeak('Peak: 1 dBFS'));
 assert.throws(()=>parseTruePeak('Summary:\nTrue peak:\n Peak: inf dBFS'));
});
test('failed or stuck measurement processes reject instead of approving audio',async()=>{
 await assert.rejects(runAudioFfmpeg(['-e','process.exit(1)'],{binary:process.execPath}));
 await assert.rejects(runAudioFfmpeg(['-e','setInterval(()=>{},1000)'],{binary:process.execPath,timeoutMs:50}),/timed out/);
});
