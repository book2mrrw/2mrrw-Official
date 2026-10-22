import test from 'node:test';import assert from 'node:assert/strict';
import {editorModel,decodeLyrics,encodeLyrics,encodeDraft,timingErrors,wordProgress,shiftTiming,lyricClock,validateLyricText} from '../timing.js';
import {parseLrc} from '../../lrc.js';
const fingerprint='a'.repeat(64);
const model=()=>({reference:fingerprint,duration:10,lines:[{time:1,text:'Hello world',words:[{text:'Hello ',time:1,end:2},{text:'world',time:2.5,end:3}]}]});
test('enhanced LRC round-trips real word start/end cues including silence between words',()=>{
 const value=encodeLyrics(model());const decoded=decodeLyrics(value);assert.equal(decoded.reference,fingerprint);assert.equal(decoded.lines[0].text,'Hello world');assert.deepEqual(decoded.lines[0].words,model().lines[0].words);assert.equal(parseLrc(value)[0].words[1].time,2.5);
});
test('unfinished drafts retain exact partial and invalid input without becoming publishable',()=>{
 const state=model();state.lines[0].words[1].end=null;state.lines[0].time=-1;const value=encodeDraft(state);assert.deepEqual(decodeLyrics(value).lines,state.lines);assert.match(validateLyricText(value).join(),/Apply/);assert.throws(()=>encodeLyrics(state));
});
test('line and word validations reject missing, negative, unordered, overlapping and out-of-duration cues',()=>{
 for(const change of [m=>m.lines[0].time=null,m=>m.lines[0].time=-1,m=>m.lines[0].words[0].end=0,m=>m.lines[0].words[1].time=1.5,m=>m.lines[0].words[1].end=11,m=>m.lines[0].text='Other words']){const m=model();change(m);assert.ok(timingErrors(m).length);}
});
test('line-only lyrics and plain text remain supported without invented word times',()=>{
 const state=editorModel('First line\n\nNext line\n');assert.equal(state.plainText,'First line\n\nNext line\n');assert.equal(state.lines[0].words[0].time,null);
 state.reference=fingerprint;state.duration=10;state.lines[0].time=1;state.lines[1].time=5;const text=encodeLyrics(state);assert.match(text,/\n\n\[00:05.000\]/);assert.equal(decodeLyrics(text).lines[1].time,5);
 assert.deepEqual(validateLyricText('ordinary\ntext'),[]);
});
test('word progress is derived from audio position and responds to seeking backwards',()=>{
 const word=model().lines[0].words[0];assert.equal(wordProgress(word,0),0);assert.equal(wordProgress(word,1.5),.5);assert.equal(wordProgress(word,5),1);assert.equal(wordProgress(word,1),0);
});
test('bulk offset never mutates the original and invalid negative shifts cannot publish',()=>{
 const original=model();const shifted=shiftTiming(original,-2);assert.equal(original.lines[0].time,1);assert.ok(timingErrors(shifted).length);assert.equal(shiftTiming(original,.125).lines[0].words[1].end,3.125);
});
test('a different playing recording never drives the lyric clock',()=>{
 const options={currentTrack:{slug:'album',id:'album:one',metadata:{albumSlug:'album',trackSlug:'one'}},releaseSlug:'album',recording:{slug:'two'},isPreview:false,currentTime:2};assert.equal(lyricClock(options),null);options.recording.slug='one';assert.equal(lyricClock(options),2);options.releaseSlug='other';assert.equal(lyricClock(options),null);
});
test('preview clock uses a known recording offset and fails closed when the offset is unknown',()=>{
 const o={currentTrack:{slug:'single',metadata:{access:{previewOnly:true}}},releaseSlug:'single',isPreview:true,currentTime:2,previewStartSeconds:60};assert.equal(lyricClock(o),62);delete o.previewStartSeconds;assert.equal(lyricClock(o),null);o.currentTrack.metadata.access.previewOnly=false;assert.equal(lyricClock(o),2);
});
