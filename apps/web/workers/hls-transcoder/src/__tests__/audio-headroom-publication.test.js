import test,{mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import * as policy from '../audio-headroom.js';
let downloads,uploads,encodes,measurements,failAlways,failedMeasurements;
// The website's session for this lease (lane-transfers.js): the source, the write links, the song's key.
const lane={open:async()=>({prefix:'isolated/',encryption:{key:'0f'.repeat(16),iv:'a5'.repeat(16)}}),
 downloadSource:async file=>{downloads++;fs.writeFileSync(file,'source');},
 uploadFiles:async items=>{assert.ok(measurements>=4);uploads+=items.length;}};
process.env.VIDEO_SCRATCH_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'audio-scratch-'));
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
const job={id:'test',slug:'test',source_key:'source',hls_prefix:'isolated/',release_type:'singles',bitrates:['96k','64k'],claim_token:'lease-1',target_profile_version:3};
test('all tiers are re-encoded at common attenuation and source downloaded once',async t=>{
 const old=process.env.HLS_MASTER_SECRET;process.env.HLS_MASTER_SECRET='test';t.after(()=>{if(old===undefined)delete process.env.HLS_MASTER_SECRET;else process.env.HLS_MASTER_SECRET=old;});
 const result=await transcode({job,lane});assert.equal(downloads,1);assert.equal(uploads,2);assert.equal(encodes.length,4);
 assert.equal(result.transcode_profile_version,3);
 assert.deepEqual(result.source_metadata,{source_key:'source',sha256:crypto.createHash('sha256').update('source').digest('hex')});
 assert.deepEqual(Object.keys(result.segment_durations).sort(),['64k','96k']);
 assert.equal(encodes[0],encodes[1]);assert.equal(encodes[2],encodes[3]);assert.notEqual(encodes[0],encodes[2]);
 assert.equal(result.rendition_metadata['96k'].headroom.gain_db,result.rendition_metadata['64k'].headroom.gain_db);
});
test('exhausted verification never uploads or returns publishable metadata',async t=>{
 const old=process.env.HLS_MASTER_SECRET;process.env.HLS_MASTER_SECRET='test';t.after(()=>{if(old===undefined)delete process.env.HLS_MASTER_SECRET;else process.env.HLS_MASTER_SECRET=old;});
 failAlways=true;await assert.rejects(transcode({job,lane}),/true-peak ceiling/);assert.equal(uploads,0);assert.equal(encodes.length,policy.MAX_HEADROOM_PASSES*job.bitrates.length);
});
test('a fourth measured pass can qualify the entire ladder without early publication',async t=>{
 const old=process.env.HLS_MASTER_SECRET;process.env.HLS_MASTER_SECRET='test';t.after(()=>{if(old===undefined)delete process.env.HLS_MASTER_SECRET;else process.env.HLS_MASTER_SECRET=old;});
 failedMeasurements=6;
 const result=await transcode({job,lane});
 assert.equal(downloads,1);assert.equal(encodes.length,8);assert.equal(uploads,2);
 for(let i=0;i<encodes.length;i+=2)assert.equal(encodes[i],encodes[i+1]);
 assert.equal(result.rendition_metadata['96k'].headroom.decoded_peak_dbtp,-2);
 assert.equal(result.rendition_metadata['64k'].headroom.decoded_peak_dbtp,-2);
});
test('a job asking for a newer audio profile is refused before anything is downloaded',async()=>{
 await assert.rejects(transcode({job:{...job,target_profile_version:4},lane}),err=>err.failureCategory==='VALIDATION_FAILURE');
 assert.equal(downloads,0);
});
