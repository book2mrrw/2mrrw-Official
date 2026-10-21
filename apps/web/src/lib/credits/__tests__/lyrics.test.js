import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLrc,getActiveLrcIndex} from '../../lrc.js';
import {lyricsFromSource,recordingEditorial} from '../../../components/preview/releaseMetadata.js';
test('ordinary untimed lyrics retain all lines and never acquire invented timestamps',()=>{
 const rows=parseLrc('First line\n\nSecond line');assert.deepEqual(rows,[{time:null,text:'First line'},{time:null,text:'Second line'}]);assert.equal(getActiveLrcIndex(rows,45),-1);
});
test('LRC timestamps retain ordering, repeats and decimal precision',()=>{
 const rows=parseLrc('[ar:Artist]\n[00:10.123]Later\n[00:01.5][00:02.50]Earlier');assert.deepEqual(rows.map(r=>r.time),[1.5,2.5,10.123]);assert.equal(getActiveLrcIndex(rows,1.5),0);
});
test('metadata-only and missing lyrics produce an actual empty state',()=>{for(const value of ['',null,'[ar:Artist]\n[ti:Title]'])assert.deepEqual(parseLrc(value),[]);});
test('saved empty lyrics suppress stale metadata and text fallbacks',()=>assert.equal(lyricsFromSource({lyrics:'',metadata:{lyrics:'old'}}),''));
test('recordings resolve source UUID, catalog UUID and slug without first-track fallback',()=>{
 const release={tracks:[{id:'a',catalog_track_id:'catalog-a',slug:'one',lyrics:'first'},{id:'b',catalog_track_id:'catalog-b',slug:'two',lyrics:'second'}]};
 for(const track of [{id:'catalog-b'},{track_id:'b'},{slug:'two'}])assert.equal(recordingEditorial(release,track).lyrics,'second');assert.equal(recordingEditorial(release,{id:'unrelated'}),null);
});
