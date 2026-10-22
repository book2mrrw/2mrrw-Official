"use client";
import TimedLyricWords from "@/components/lyrics/TimedLyricWords";
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {plainLyrics,editorModel,encodeDraft,encodeLyrics,shiftTiming,timingErrors,wordsFor,MAX_LYRIC_LENGTH} from '@/lib/lyrics/timing';
const input={background:'#15151b',color:'#fff',border:'1px solid #555',borderRadius:6,padding:'8px',maxWidth:'100%'};
const control={...input,cursor:'pointer',minHeight:40};
const numeric=value=>value===''?null:Number(value);
export default function LyricTimingEditor({value='',onChange,releaseId,recordingId,title='Recording',disabled=false}){
 const displayText=v=>{const m=editorModel(v);return m.draft||m.lines.some(l=>l.time!=null)?m.plainText??m.lines.map(l=>l.text).join('\n'):v;};
 const [text,setText]=useState(()=>displayText(value));
 const uid=useId();const model=useMemo(()=>editorModel(value),[value]);const latest=useRef(value);const history=useRef({past:[],future:[]});
 const [tab,setTab]=useState('text'),[mode,setMode]=useState('line'),[lineIndex,setLineIndex]=useState(0),[wordIndex,setWordIndex]=useState(0);
 const [source,setSource]=useState({status:'idle'}),[notice,setNotice]=useState(''),[reviewed,setReviewed]=useState(false),[current,setCurrent]=useState(0),[offset,setOffset]=useState('0'),[rate,setRate]=useState(1);
 const [historyCounts,setHistoryCounts]=useState({past:0,future:0});const audio=useRef(null),held=useRef(null),abort=useRef(null),alive=useRef(true);
 useEffect(()=>{if(value!==latest.current)setText(displayText(value));latest.current=value;},[value]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useEffect(()=>{const el=audio.current;return()=>{held.current=null;el?.pause();};},[source.fingerprint,tab]);
 const emit=(next,remember=true)=>{if(disabled)return;if(remember){history.current.past=[...history.current.past,latest.current].slice(-100);history.current.future=[];}latest.current=next;onChange(next);setHistoryCounts({past:history.current.past.length,future:history.current.future.length});};
 const mutate=fn=>{try{const next=fn(editorModel(latest.current));emit(encodeDraft(next));setNotice('Timing draft retained. Apply timings before saving or publishing.');}catch(e){setNotice(e.message);}};
 const moveHistory=direction=>{const from=history.current[direction];if(!from.length)return;const next=from.pop();history.current[direction==='past'?'future':'past'].push(latest.current);setText(displayText(next));emit(next,false);};
 const changeText=text=>{
  setText(text);
  const old=editorModel(latest.current);const next=editorModel(text);
  next.lines=next.lines.map((line,i)=>old.lines[i]?.text===line.text?{...old.lines[i],gapBefore:line.gapBefore}:line);
  if(old.lines.some(l=>l.time!=null)){mutate(()=>({...old,lines:next.lines,plainText:text}));}else emit(text);
 };
 const loadReference=async()=>{
  if(!releaseId||!recordingId){setNotice('Upload the recording audio before synchronizing.');return;}
  abort.current?.abort();const request=new AbortController();abort.current=request;setSource({status:'loading'});setCurrent(0);setNotice('');setReviewed(false);
  const endpoint=`/api/admin/releases/${encodeURIComponent(releaseId)}/tracks/${encodeURIComponent(recordingId)}/lyrics-audio`;
  try{const res=await fetch(endpoint+'?metadata=1',{signal:request.signal,cache:'no-store'});const body=await res.json();if(!res.ok)throw Error(body.error||'Reference could not be loaded.');if(alive.current&&!request.signal.aborted)setSource({status:'ready',...body,url:endpoint+'?revision='+body.fingerprint});}
  catch(e){if(e.name!=='AbortError'&&alive.current){setSource({status:'error'});setNotice(e.message);}}
 };
 const markLine=()=>{
  const time=audio.current?.currentTime;if(!Number.isFinite(time)){setNotice('Load the recording reference first.');return;}
  mutate(m=>({...m,lines:m.lines.map((l,i)=>i===lineIndex?{...l,time,words:wordsFor(l.text)}:l)}));setLineIndex(i=>Math.min(i+1,model.lines.length-1));setWordIndex(0);
 };
 const startWord=()=>{
  const time=audio.current?.currentTime;const row=model.lines[lineIndex];if(!Number.isFinite(time)||!row?.words[wordIndex]){setNotice('Load the reference and select a word first.');return;}
  held.current={time,line:lineIndex,word:wordIndex};setNotice('Release when this word finishes.');
 };
 const endWord=()=>{
  const capture=held.current;held.current=null;if(!capture)return;const end=audio.current?.currentTime;
  if(!Number.isFinite(end)||end<=capture.time){setNotice('Play the reference while holding, or enter start/end times manually.');return;}
  mutate(m=>({...m,lines:m.lines.map((l,i)=>i!==capture.line?l:{...l,time:capture.word===0?capture.time:l.time,words:l.words.map((w,j)=>j===capture.word?{...w,time:capture.time,end}:w)})}));
  if(capture.word+1<model.lines[capture.line].words.length)setWordIndex(capture.word+1);else{setWordIndex(0);setLineIndex(i=>Math.min(i+1,model.lines.length-1));}
 };
 const apply=()=>{
  const next={...model,reference:source.fingerprint,duration:source.duration};const errors=timingErrors(next,{requireReference:true});
  if(model.reference&&model.reference!==source.fingerprint&&!reviewed)errors.push('Review the timings against the changed reference and confirm below.');
  if(errors.length){setNotice(errors.join(' '));return;}
  emit(encodeLyrics(next));setNotice('Timings applied. Save the release or continue the upload to persist them.');
 };
 const download=()=>{const blob=new Blob([value],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${title.replace(/[^\p{L}\p{N} _-]/gu,'')||'lyrics'}.lrc`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const selected=model.lines[lineIndex];const changed=source.fingerprint&&model.reference&&model.reference!==source.fingerprint;
 return <fieldset disabled={disabled} aria-label={`${title} lyric editor`} onBlur={()=>{held.current=null;}} onKeyDown={e=>{
  if(e.code!=='Space'||e.repeat||tab!=='timing'||/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))return;e.preventDefault();if(mode==='line')markLine();else startWord();
 }} onKeyUp={e=>{if(e.code==='Space'&&held.current){e.preventDefault();endWord();}}} style={{border:'1px solid #444',borderRadius:10,padding:14,color:'#eee',marginBottom:16,minWidth:0}}>
  <legend>{title} lyrics</legend>
  <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
   <button type="button" style={control} aria-pressed={tab==='text'} onClick={()=>setTab('text')}>Text</button>
   <button type="button" style={control} aria-pressed={tab==='timing'} onClick={()=>setTab('timing')}>Synchronize</button>
   <button type="button" style={control} disabled={!historyCounts.past} onClick={()=>moveHistory('past')}>Undo</button>
   <button type="button" style={control} disabled={!historyCounts.future} onClick={()=>moveHistory('future')}>Redo</button>
   <label style={control}>Import LRC<input aria-label="Import lyrics" type="file" accept=".lrc,.txt,text/plain" style={{display:'block',maxWidth:200}} onChange={async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>MAX_LYRIC_LENGTH*4){setNotice('The lyric file is too large.');return;}const text=await file.text();if(alive.current){setText(displayText(text));emit(text);}
   }}/></label>
   <button type="button" style={control} disabled={model.draft||!value} onClick={download}>Export LRC</button>
  </div>
  {tab==='text'?<label htmlFor={uid}>Lyrics text<textarea id={uid} aria-label={`${title} lyrics text`} value={text} rows={10} onChange={e=>changeText(e.target.value)} style={{...input,display:'block',width:'100%',boxSizing:'border-box',lineHeight:1.7}}/></label>:<div tabIndex={0} aria-label="Lyric synchronization workspace">
   <p>Mark each line when its first word is sung. For word timing, hold the capture button while a word is sung and release at its end. Space works while this workspace has focus.</p>
   <button type="button" style={control} disabled={source.status==='loading'} onClick={loadReference}>{source.status==='loading'?'Loading reference…':source.status==='ready'?'Reload recording reference':'Load recording reference'}</button>
   {source.url?<audio data-lyric-reference key={source.fingerprint} ref={audio} controls preload="metadata" src={source.url} style={{width:'100%',margin:'12px 0'}}
    onLoadedMetadata={e=>{e.currentTarget.playbackRate=rate;setCurrent(e.currentTarget.currentTime);const duration=e.currentTarget.duration;if(Number.isFinite(duration)&&duration>0)setSource(p=>({...p,duration}));}}
    onTimeUpdate={e=>setCurrent(e.currentTarget.currentTime)} onSeeked={e=>setCurrent(e.currentTarget.currentTime)}
    onError={()=>setNotice('Reference playback failed. Reload it or use a browser that supports this audio format.')} onPlay={e=>{document.querySelectorAll('audio[data-lyric-reference]').forEach(el=>{if(el!==e.currentTarget)el.pause();});}}/>:null}
   <p role="status">Reference time: {Number.isFinite(current)?current.toFixed(3):'0.000'}s</p>
   <label>Playback speed <select aria-label="Reference playback speed" style={input} value={rate} onChange={e=>{const next=Number(e.target.value);setRate(next);if(audio.current)audio.current.playbackRate=next;}}>{[0.5,0.75,1,1.25].map(n=><option key={n} value={n}>{n}×</option>)}</select></label>
   <label>Timing mode <select aria-label="Timing mode" style={input} value={mode} onChange={e=>{setMode(e.target.value);setWordIndex(0);}}><option value="line">Lines</option><option value="word">Words</option></select></label>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'12px 0'}}>
    <button type="button" style={control} disabled={source.status!=='ready'||!selected} onClick={mode==='line'?markLine:undefined}
     onPointerDown={mode==='word'?e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);startWord();}:undefined}
     onPointerUp={mode==='word'?endWord:undefined} onPointerCancel={()=>{held.current=null;}} onLostPointerCapture={()=>{held.current=null;}}
     onKeyDown={mode==='word'?e=>{if(e.code==='Space'&&!e.repeat){e.preventDefault();e.stopPropagation();startWord();}}:undefined}
     onKeyUp={mode==='word'?e=>{if(e.code==='Space'){e.preventDefault();e.stopPropagation();endWord();}}:undefined}>{mode==='line'?'Mark selected line':'Hold to time selected word'}</button>
    <button type="button" style={control} onClick={()=>mutate(m=>({...m,lines:m.lines.map(l=>({...l,time:null,words:wordsFor(l.text)}))}))}>Clear timings</button>
    <label>Shift all (seconds)<input aria-label="Shift all timings" style={{...input,width:85}} inputMode="decimal" value={offset} onChange={e=>setOffset(e.target.value)}/></label>
    <button type="button" style={control} onClick={()=>{try{mutate(m=>shiftTiming(m,Number(offset)));}catch(e){setNotice(e.message);}}}>Shift timings</button>
   </div>
   <div aria-label="Timed lyric lines" style={{maxHeight:450,overflowY:'auto'}}>{model.lines.map((line,i)=><section key={i} style={{padding:12,border:'1px solid #555',marginBottom:8,background:i===lineIndex?'#24243b':'#111'}}>
    <button type="button" style={control} aria-pressed={i===lineIndex} onClick={()=>{setLineIndex(i);setWordIndex(0);}}>Select line {i+1}</button> <strong>{line.text}</strong>
    <label>Line {i+1} start<input aria-label={`Line ${i+1} start`} type="number" min="0" step="0.001" style={{...input,width:100}} value={line.time??''} onChange={e=>{const time=numeric(e.target.value);mutate(m=>({...m,lines:m.lines.map((l,j)=>j===i?{...l,time}:l)}));}}/></label>
    {mode==='word'?line.words.map((word,j)=><div key={j} style={{display:'flex',gap:6,flexWrap:'wrap',paddingTop:8}}>
     <button type="button" style={control} aria-label={`Select line ${i+1} word ${j+1}`} aria-pressed={i===lineIndex&&j===wordIndex} onClick={()=>{setLineIndex(i);setWordIndex(j);}}>{word.text}</button>
     {['time','end'].map(field=><label key={field}>{field==='time'?'Start':'End'}<input aria-label={`Line ${i+1} word ${j+1} ${field==='time'?'start':'end'}`} type="number" min="0" step="0.001" style={{...input,width:95}} value={word[field]??''} onChange={e=>{const number=numeric(e.target.value);mutate(m=>({...m,lines:m.lines.map((l,k)=>k===i?{...l,...(j===0&&field==='time'?{time:number}:{}),words:l.words.map((w,n)=>n===j?{...w,[field]:number}:w)}:l)}));}}/></label>)}
    </div>):null}
    <div aria-label={`Line ${i+1} timing preview`} style={{fontSize:22,fontWeight:800,paddingTop:10}}>{line.words.some(w=>w.time!=null)?<TimedLyricWords words={line.words} currentTime={current}/>:line.text}</div>
   </section>)}</div>
   {changed?<label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed these timings against the changed recording.</label>:null}
   <button type="button" style={{...control,marginTop:12}} disabled={source.status!=='ready'} onClick={apply}>Apply timings</button>
   <button type="button" style={{...control,margin:12}} onClick={()=>{emit(plainLyrics(value));setText(plainLyrics(value));setNotice('Timing removed; lyric text retained.');}}>Keep text only</button>
  </div>}
  {model.draft?<p role="status">Unfinished timing is retained locally and in upload drafts. Apply it before saving a released song or publishing.</p>:null}
  {notice?<p role="status" style={{lineHeight:1.6,overflowWrap:'anywhere'}}>{notice}</p>:null}
 </fieldset>;
}
