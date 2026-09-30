import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrackVisual, visualEncodeArgs } from '../track-visual-policy.js';
const source = { durationSeconds: 7, frameRate: 30, width: 3840, height: 2160, hdrMode: 'sdr' };
test('visual ladder preserves portrait orientation and never upscales', () => {
 const landscape = planTrackVisual(source);
 assert.deepEqual(landscape.map(r=>r.width),[3840,1920,1280,854]);
 const portrait = planTrackVisual({...source,rotationDegrees:90});
 assert.deepEqual(portrait.map(r=>[r.width,r.height]),landscape.map(r=>[r.height,r.width]));
 assert.deepEqual(planTrackVisual({...source,width:640,height:360}).map(r=>r.width),[640]);
 assert.equal(planTrackVisual({...source,width:7680,height:4320})[0].width,3840);
});
test('duration and malformed source bounds are enforced before encoding', () => {
 for(const durationSeconds of [0,6.99,30.01,NaN,Infinity]) assert.throws(()=>planTrackVisual({...source,durationSeconds}));
 assert.equal(planTrackVisual({...source,durationSeconds:30}).length,4);
 for(const frameRate of [0,NaN,Infinity,121]) assert.throws(()=>planTrackVisual({...source,frameRate}));
 assert.throws(()=>planTrackVisual({...source,width:20000}));
});
test('all encodes explicitly discard audio, subtitles and data streams', () => {
 for(const r of planTrackVisual(source)) {
  const args=visualEncodeArgs({sourcePath:'/input',outputDir:'/output',rendition:r,keyInfo:'/key'});
  for(const flag of ['-an','-sn','-dn']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('-map')+1],'0:v:0');
  assert.ok(!args.includes('-c:a'));
  assert.equal(args[args.indexOf('-hls_key_info_file')+1],'/key');
 }
});
