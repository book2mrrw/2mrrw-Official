import test from 'node:test';
import assert from 'node:assert/strict';
import {getActiveLrcIndex} from '../../lrc.js';
import * as timing from '../timing.js';

const lines=[{text:'Held phrase',time:1,words:[{text:'Held phrase',time:1,end:2}]},{text:'Next phrase',time:10}];
test('line starts are inclusive, next starts exclusive, with no early visual offset',()=>{
  for(const [time,index] of [[.999,-1],[1,0],[9.951,0],[9.999,0],[10,1]])assert.equal(getActiveLrcIndex(lines,time),index);
});
test('a whole phrase outlives word endings and holds through the interval until its next real cue',()=>{
  for(const time of [2,5,9.99])assert.equal(getActiveLrcIndex(lines,time),0);
});
test('unknown, negative and nonfinite positions never highlight a line',()=>{
  for(const time of [null,undefined,NaN,Infinity,-1])assert.equal(getActiveLrcIndex(lines,time),-1);
});
test('a final line holds to known recording duration, or indefinitely while the actual clock is valid',()=>{
  assert.equal(getActiveLrcIndex(lines,19.99,{duration:20}),1);
  assert.equal(getActiveLrcIndex(lines,20,{duration:20}),-1);
  assert.equal(getActiveLrcIndex(lines,1000),1);
});
test('missing cues stay visible and do not prevent later real cues from activating',()=>{
  const rows=[{text:'First',time:1},{text:'Untimed',time:null},{text:'Last',time:8}];
  assert.equal(getActiveLrcIndex(rows,5),0);assert.equal(getActiveLrcIndex(rows,8),2);
});
test('duplicate cues select the final source row at that exact timestamp',()=>{
  const rows=[{time:1},{time:3},{time:3},{time:6}];
  assert.equal(getActiveLrcIndex(rows,2.999),0);assert.equal(getActiveLrcIndex(rows,3),2);assert.equal(getActiveLrcIndex(rows,6),3);
});
test('legacy unsorted rows select by time without mutating text order; invalid starts are ignored',()=>{
  const rows=[{text:'Later',time:10},{text:'Earlier',time:1},{text:'Invalid',time:-1},{text:'Missing',time:null}];
  assert.equal(getActiveLrcIndex(rows,5),1);assert.equal(getActiveLrcIndex(rows,10),0);
  assert.deepEqual(rows.map(row=>row.text),['Later','Earlier','Invalid','Missing']);
});
test('forward/backward seeks, pauses and repeated samples are pure functions of the supplied clock',()=>{
  assert.deepEqual([1,5,5,12,1,.5,10].map(time=>getActiveLrcIndex(lines,time)),[0,0,0,1,0,-1,1]);
});
test('display intervals and rehearsal use the next strictly later cue, including duplicate starts',()=>{
  assert.deepEqual(timing.lyricInterval([{time:1},{time:1},{time:10}],0,20),{start:1,end:10});
  assert.deepEqual(timing.lyricInterval(lines,0,20),{start:1,end:10});
});
test('a known final duration bounds the last phrase; an unknown final duration is never guessed',()=>{
  assert.deepEqual(timing.lyricInterval(lines,1,30),{start:10,end:30});
  assert.deepEqual(timing.lyricInterval(lines,1),{start:10,end:null});
  assert.equal(timing.lyricInterval([{time:null}],0,30),null);
});
test('text insertion and deletion preserve neighboring recording cues including repeated choruses',()=>{
  assert.equal(typeof timing.reconcileLyricLines,'function');
  const old=timing.editorModel('Verse\nChorus\nBridge\nChorus').lines.map((line,i)=>({...line,time:i*5+1}));
  const next=timing.reconcileLyricLines(old,timing.editorModel('Verse\nNew phrase\nChorus\nChorus').lines);
  assert.deepEqual(next.map(line=>line.time),[1,null,6,16]);
  assert.deepEqual(old.map(line=>line.time),[1,6,11,16]);
});
test('splitting and merging a line clear only changed rows, retaining exact following text and stanza gaps',()=>{
  assert.equal(typeof timing.reconcileLyricLines,'function');
  const old=timing.editorModel('Long phrase\n\nEnding').lines.map((line,i)=>({...line,time:i*10+1}));
  const split=timing.reconcileLyricLines(old,timing.editorModel('Long\nphrase\n\nEnding').lines);
  assert.deepEqual(split.map(line=>line.time),[null,null,11]);assert.equal(split[2].gapBefore,1);
  const merged=timing.reconcileLyricLines(old,timing.editorModel('Long phrase Ending').lines);
  assert.equal(merged[0].time,null);
});
