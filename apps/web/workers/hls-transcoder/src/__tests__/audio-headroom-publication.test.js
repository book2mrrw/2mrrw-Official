import test,{mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import * as policy from '../audio-headroom.js';
let downloads,uploads,encodes,measurements,failAlways,failedMeasurements;
mock.module('../r2.js',{namedExports:{downloadStream:async()=>{downloads++;return Readable.from(['source']);},upload:async()=>{assert.ok(measurements>=4);uploads++;}}});
mock.module('../audio-headroom.js',{namedExports:{...policy,
 runAudioFfmpeg:async args=>{
  encodes.push(args[args.indexOf('-af')+1]);
  const file=args.at(-1);fs.writeFileSync(file,'#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg_00000.ts\n#EXT-X-ENDLIST\n');fs.writeFileSync(path.join(path.dirname(file),'seg_00000.ts'),Buffer.alloc(100));
 },
 measureTruePeak:async(_,opts)=>{
  if(!opts?.encrypted)return 0.6;
  assert.equal(uploads,0,'all decoded measurements precede publication');
  measurements++;return failAlways||measurements<=failedMeasurements?0.5:-2;
 }
}});
const {transcode}=await import('../transcoder.js');
beforeEach(()=>{downloads=uploads=measurements=0;encodes=[];failAlways=false;failedMeasurements=2;});
const job={id:'test',slug:'test',source_key:'source',hls_prefix:'isolated/',release_type:'singles',bitrates:['96k','64k']};
test('all tiers are re-encoded at common attenuation and source downloaded once',async t=>{
 const old=process.env.HLS_MASTER_SECRET;process.env.HLS_MASTER_SECRET='test';t.after(()=>{if(old===undefined)delete process.env.HLS_MASTER_SECRET;else process.env.HLS_MASTER_SECRET=old;});
 const result=await transcode({job});assert.equal(downloads,1);assert.equal(uploads,2);assert.equal(encodes.length,4);
 assert.equal(encodes[0],encodes[1]);assert.equal(encodes[2],encodes[3]);assert.notEqual(encodes[0],encodes[2]);
 assert.equal(result.rendition_metadata['96k'].headroom.gain_db,result.rendition_metadata['64k'].headroom.gain_db);
});
test('exhausted verification never uploads or returns publishable metadata',async t=>{
 const old=process.env.HLS_MASTER_SECRET;process.env.HLS_MASTER_SECRET='test';t.after(()=>{if(old===undefined)delete process.env.HLS_MASTER_SECRET;else process.env.HLS_MASTER_SECRET=old;});
 failAlways=true;await assert.rejects(transcode({job}),/true-peak ceiling/);assert.equal(uploads,0);assert.equal(encodes.length,policy.MAX_HEADROOM_PASSES*job.bitrates.length);
});
test('a fourth measured pass can qualify the entire ladder without early publication',async t=>{
 const old=process.env.HLS_MASTER_SECRET;process.env.HLS_MASTER_SECRET='test';t.after(()=>{if(old===undefined)delete process.env.HLS_MASTER_SECRET;else process.env.HLS_MASTER_SECRET=old;});
 failedMeasurements=6;
 const result=await transcode({job});
 assert.equal(downloads,1);assert.equal(encodes.length,8);assert.equal(uploads,2);
 for(let i=0;i<encodes.length;i+=2)assert.equal(encodes[i],encodes[i+1]);
 assert.equal(result.rendition_metadata['96k'].headroom.decoded_peak_dbtp,-2);
 assert.equal(result.rendition_metadata['64k'].headroom.decoded_peak_dbtp,-2);
});
