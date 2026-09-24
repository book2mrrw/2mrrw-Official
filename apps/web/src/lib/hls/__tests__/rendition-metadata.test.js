import test from 'node:test';
import assert from 'node:assert/strict';
import {measureAudioRendition} from '../../../../workers/hls-transcoder/src/audio-rendition-metadata.js';
import {measuredRendition,renditionBandwidthAttributes} from '../rendition-metadata.js';
const playlist = durations => '#EXTM3U\n#EXT-X-TARGETDURATION:6\n'+durations.map((d,i)=>`#EXTINF:${d},\nseg_${i}.ts`).join('\n')+'\n#EXT-X-ENDLIST';

test('measured peak considers contiguous windows and retains exact durations across JSON storage',()=>{
  const {metadata}=measureAudioRendition(playlist([6.014,5.991,1.995]),name=>[60000,90000,90000][Number(name.match(/\d+/)[0])]);
  const expectedPeak=Math.ceil(180000*8/(5.991+1.995));
  assert.equal(metadata.bandwidth,expectedPeak);
  assert.equal(metadata.average_bandwidth,Math.ceil(240000*8/14));
  const manifest=JSON.parse(JSON.stringify({segment_counts:{'64k':3},rendition_metadata:{'64k':metadata}}));
  assert.deepEqual(measuredRendition(manifest,'64k').segment_durations,[6.014,5.991,1.995]);
  assert.equal(renditionBandwidthAttributes(manifest,'64k'),`BANDWIDTH=${expectedPeak},AVERAGE-BANDWIDTH=137143`);
});

test('a clip shorter than half the target has a finite conservative whole-clip rate',()=>{
  const {metadata}=measureAudioRendition(playlist([0.5]),()=>10000);
  assert.equal(metadata.bandwidth,160000);
  assert.equal(metadata.average_bandwidth,160000);
});

test('incomplete, malformed and unsafe worker outputs fail before publication',()=>{
  for(const text of [playlist([6]).replace('#EXT-X-ENDLIST',''),playlist([0]),playlist([7]),playlist([6]).replace('seg_0.ts','../seg_0.ts'),playlist([6,6]).replace('seg_1.ts','seg_0.ts')]) {
    assert.throws(()=>measureAudioRendition(text,()=>1000));
  }
  assert.throws(()=>measureAudioRendition(playlist([6]),()=>0));
});

test('legacy, wrong-version and mismatched metadata retain existing bandwidth values',()=>{
  assert.equal(renditionBandwidthAttributes({},'64k'),'BANDWIDTH=72000');
  const {metadata}=measureAudioRendition(playlist([6]),()=>60000);
  for(const invalid of [{...metadata,version:2},{...metadata,bandwidth:'80000'},{...metadata,segment_durations:[6,6]},{...metadata,segment_durations:[NaN]}]) {
    const manifest={segment_counts:{'96k':1},rendition_metadata:{'96k':invalid}};
    assert.equal(measuredRendition(manifest,'96k'),null);
    assert.equal(renditionBandwidthAttributes(manifest,'96k'),'BANDWIDTH=108000');
  }
});
