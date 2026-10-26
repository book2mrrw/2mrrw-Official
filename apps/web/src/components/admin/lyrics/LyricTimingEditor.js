"use client";

import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import LyricTranscript from '@/components/lyrics/LyricTranscript';
import {useAudioPlayer} from '@/context/AudioContext';
import {plainLyrics,editorModel,encodeDraft,encodeLyrics,shiftTiming,timingErrors,wordsFor,isTime,formatCue,lyricStatus,activeLyricIndex,lyricInterval,reconcileLyricLines,MAX_LYRIC_LENGTH} from '@/lib/lyrics/timing';
import styles from './LyricTimingEditor.module.css';
import useLyricWorkingDraft from './useLyricWorkingDraft';

const numeric=value=>value===''?null:Number(value);
const clock=value=>isTime(value)?formatCue(value):'00:00.000';
const displayText=value=>{const model=editorModel(value);return model.draft||model.lines.some(line=>line.time!=null)?model.plainText??model.lines.map(line=>line.text).join('\n'):value;};
const editable=target=>target?.closest?.('input,textarea,select,audio,video,[contenteditable="true"]');

function Icon({name}) {
 const shapes={
  play:<path d="m9 5 10 7-10 7Z" fill="currentColor"/>,pause:<><path d="M8 5v14M16 5v14" strokeWidth="4"/></>,
  undo:<><path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3"/></>,redo:<><path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v3"/></>,
  tap:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M1 12h2M21 12h2"/></>,
  audio:<><path d="M5 9v6M9 5v14M13 2v20M17 6v12M21 9v6"/></>,
  check:<path d="m5 12 4 4L19 6"/>,download:<><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
  upload:<><path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/></>,
  left:<path d="m14 6-6 6 6 6"/>,right:<path d="m10 6 6 6-6 6"/>,loop:<><path d="m17 2 4 4-4 4M21 6H7a4 4 0 0 0-4 4m4 12-4-4 4-4M3 18h14a4 4 0 0 0 4-4"/></>,
 };
 return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]||shapes.tap}</svg>;
}

export default function LyricTimingEditor(props) {
 return <LyricTimingWorkspace key={`${props.draftOwnerId||''}:${props.releaseId||''}:${props.recordingId||''}`} {...props}/>;
}

function LyricTimingWorkspace({value='',onChange,releaseId,recordingId,title='Recording',disabled=false,coverUrl=null,saveContext='release',savedValue,draftOwnerId,onDraftState,onSaveDraft,draftState}) {
 const uid=useId();
 const background=useAudioPlayer();
 const model=useMemo(()=>editorModel(value),[value]);
 const [text,setText]=useState(()=>displayText(value));
 const [tab,setTab]=useState('text'),[mode,setMode]=useState('line');
 const [lineIndex,setLineIndex]=useState(0),[wordIndex,setWordIndex]=useState(0);
 const [source,setSource]=useState({status:releaseId&&recordingId?'loading':'missing'}),[mediaReady,setMediaReady]=useState(false),[requestVersion,setRequestVersion]=useState(0);
 const [notice,setNotice]=useState(''),[noticeError,setNoticeError]=useState(false);
 const [reviewed,setReviewed]=useState(false),[current,setCurrent]=useState(0),[rate,setRate]=useState(1);
 const [offset,setOffset]=useState('0'),[playing,setPlaying]=useState(false),[loop,setLoop]=useState(false),[capturing,setCapturing]=useState(false);
 const [historyCounts,setHistoryCounts]=useState({past:0,future:0});
 const [initialValue]=useState(value),[discardPending,setDiscardPending]=useState(false),[buffering,setBuffering]=useState(false);
 const baseline=savedValue??initialValue;
 const {session:draftSession,state:workingDraftState}=useLyricWorkingDraft({authorId:draftOwnerId,releaseId,recordingId,value,baseline,onChange,onDraftState,enabled:saveContext!=='upload'});
 const saveState=saveContext==='upload'?draftState:workingDraftState;
 const latest=useRef(value),history=useRef({past:[],future:[]}),audio=useRef(null),held=useRef(null),gesture=useRef(null);
 const abort=useRef(null),alive=useRef(true),enabled=useRef(!disabled),importer=useRef(null),lineRefs=useRef([]);
 const selectedIndex=Math.max(0,Math.min(lineIndex,model.lines.length-1));
 const selected=model.lines[selectedIndex];
 const selectedWord=Math.max(0,Math.min(wordIndex,(selected?.words.length||1)-1));
 const ready=source.status==='ready'&&mediaReady;
 const changed=!!(source.fingerprint&&model.reference&&model.reference!==source.fingerprint);
 const documentStatus=useMemo(()=>lyricStatus(value),[value]);
 const applied=documentStatus==='Timing applied'&&!changed;
 const timedLines=model.lines.filter(line=>isTime(line.time)).length;
 const totalWords=model.lines.reduce((n,line)=>n+line.words.length,0);
 const hasTiming=model.draft||!!model.reference||model.lines.some(line=>isTime(line.time)||line.words.some(word=>word.time!=null||word.end!=null));
 const timedWords=model.lines.reduce((n,line)=>n+line.words.filter(word=>isTime(word.time)&&isTime(word.end)&&word.end>word.time).length,0);
 const progress=mode==='word'?timedWords:timedLines,progressTotal=mode==='word'?totalWords:model.lines.length;
 const errors=timingErrors({...model,reference:source.fingerprint||model.reference,duration:source.duration||model.duration},{requireReference:true});
 const activeLine=activeLyricIndex(model.lines,ready?current:null,{duration:source.duration||model.duration});
 const interval=useMemo(()=>lyricInterval(model.lines,selectedIndex,source.duration||model.duration),[model.lines,selectedIndex,source.duration,model.duration]);
 const saveHint=saveContext==='upload'?'Continue to Review, then publish your release.':'Use Save Lyrics below to save this song.';
 const message=useCallback((text,error=false)=>{setNotice(text);setNoticeError(error);},[]);
 const cancelCapture=useCallback(()=>{const pending=!!held.current;held.current=null;gesture.current=null;setCapturing(false);if(pending){setNotice('Capture canceled. Your previous timings are unchanged.');setNoticeError(false);}},[]);

 useEffect(()=>{if(value!==latest.current)setText(displayText(value));latest.current=value;},[value]);
 useEffect(()=>{enabled.current=!disabled;},[disabled]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();};},[]);
 useEffect(()=>{
  const element=audio.current;
  const cancel=()=>cancelCapture();
  const hidden=()=>{if(document.hidden){cancelCapture();element?.pause();}};
  window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden);
  return()=>{cancelCapture();element?.pause();window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden);};
 },[source.fingerprint,disabled,cancelCapture]);
 useEffect(()=>{
  const element=tab==='timing'?lineRefs.current[selectedIndex]:null;
  const container=element?.parentElement;
  if(element&&container)container.scrollTo?.({top:Math.max(0,element.offsetTop-container.clientHeight*.4),behavior:'auto'});
 },[selectedIndex,tab]);

 const emit=(next,remember=true)=>{
  if(!enabled.current)return;
  if(remember){history.current.past=[...history.current.past,latest.current].slice(-100);history.current.future=[];}
  draftSession?.buffer(next);latest.current=next;onChange(next);setHistoryCounts({past:history.current.past.length,future:history.current.future.length});
 };
 const mutate=fn=>{
  try{emit(encodeDraft(fn(editorModel(latest.current))));message('Timing captured in your draft. Preview it, then apply when it feels right.');return true;}
  catch(error){message(error.message,true);return false;}
 };
 const moveHistory=direction=>{
  cancelCapture();const from=history.current[direction];if(!from.length)return;
  const next=from.pop();history.current[direction==='past'?'future':'past'].push(latest.current);
  setText(displayText(next));emit(next,false);message(direction==='past'?'Last edit undone.':'Edit restored.');
 };
 const changeText=nextText=>{
  setText(nextText);const old=editorModel(latest.current),next=editorModel(nextText);
  next.lines=reconcileLyricLines(old.lines,next.lines);
  if(!next.lines.length)emit(nextText);else if(old.lines.some(line=>line.time!=null||line.words.some(word=>word.time!=null)))mutate(()=>({...old,lines:next.lines,plainText:nextText}));else emit(nextText);
  setLineIndex(index=>Math.max(0,Math.min(index,next.lines.length-1)));cancelCapture();
 };
 const selectLine=index=>{cancelCapture();message('');setLineIndex(Math.max(0,Math.min(index,model.lines.length-1)));setWordIndex(0);};
 const navigate=delta=>{
  cancelCapture();message('');
  if(mode==='word'&&selected){
   const next=selectedWord+delta;
   if(next>=0&&next<selected.words.length){setWordIndex(next);return;}
   const line=selectedIndex+delta;
   if(line>=0&&line<model.lines.length){setLineIndex(line);setWordIndex(delta<0?model.lines[line].words.length-1:0);}
  }else selectLine(selectedIndex+delta);
 };
 const loadReference=()=>{
  if(!releaseId||!recordingId){message('Upload the audio for this recording first. Then return here to add timing.',true);return;}
  abort.current?.abort();cancelCapture();audio.current?.pause();
  setSource({status:'loading'});setMediaReady(false);setPlaying(false);setBuffering(false);setCurrent(0);setReviewed(false);setLoop(false);message('');
  setRequestVersion(version=>version+1);
 };
 useEffect(()=>{
  if(!releaseId||!recordingId)return;
  const request=new AbortController();abort.current=request;
  const endpoint=`/api/admin/releases/${encodeURIComponent(releaseId)}/tracks/${encodeURIComponent(recordingId)}/lyrics-audio`;
  const prepare=async()=>{
   try{
    const response=await fetch(endpoint+'?metadata=1',{signal:request.signal,cache:'no-store'});const body=await response.json();
    if(!response.ok)throw Error(body.error||'Your recording could not be loaded.');
    if(!/^[a-f0-9]{64}$/.test(body.fingerprint))throw Error('The recording reference could not be verified. Retry your recording.');
    if(alive.current&&!request.signal.aborted)setSource({status:'ready',fingerprint:body.fingerprint,duration:isTime(body.duration)&&body.duration>0?body.duration:null,url:endpoint+'?revision='+body.fingerprint});
   }catch(error){if(!request.signal.aborted&&alive.current){setSource({status:'error'});message(error.message,true);}}
  };
  prepare();return()=>request.abort();
 },[releaseId,recordingId,requestVersion,message]);
 const readClock=()=>enabled.current&&ready&&Number.isFinite(audio.current?.currentTime)?audio.current.currentTime:null;
 const markLine=at=>{
  const time=typeof at==='number'?at:readClock();if(!enabled.current||!ready||time==null||!selected)return;
  if(mutate(state=>({...state,lines:state.lines.map((line,index)=>{
   if(index!==selectedIndex)return line;
   if(isTime(line.time)&&line.words.some(word=>word.time!=null||word.end!=null))return shiftTiming({...state,lines:[line]},time-line.time).lines[0];
   return {...line,time,words:wordsFor(line.text)};
  })}))){
   message(`Line ${selectedIndex+1} marked at ${clock(time)}.${selectedIndex+1<model.lines.length?' Next line is ready.':' All lines reached. Preview your timing.'}`);
   setLineIndex(index=>Math.min(index+1,model.lines.length-1));setWordIndex(0);
  }
 };
 const startWord=()=>{
  const time=readClock();if(time==null||!selected?.words[selectedWord])return;
  held.current={time,line:selectedIndex,word:selectedWord};setCapturing(true);message('Keep holding while this word is sung. Release when it ends.');
 };
 const endWord=()=>{
  const capture=held.current;held.current=null;setCapturing(false);if(!capture)return;
  const end=readClock();if(end==null||end<=capture.time){message('Play the recording while holding, or fine-tune the timestamps below.',true);return;}
  const state=editorModel(latest.current);if(!state.lines[capture.line]?.words[capture.word])return;
  if(mutate(state=>({...state,lines:state.lines.map((line,index)=>index!==capture.line?line:{...line,time:capture.word===0?capture.time:line.time,words:line.words.map((word,j)=>j===capture.word?{...word,time:capture.time,end}:word)})}))){
   if(capture.word+1<state.lines[capture.line].words.length)setWordIndex(capture.word+1);
   else{setWordIndex(0);setLineIndex(Math.min(capture.line+1,state.lines.length-1));}
   message(`Word captured: ${clock(capture.time)} → ${clock(end)}. The next word is ready.`);
  }
 };
 const seek=time=>{
  if(!enabled.current||!ready||!audio.current)return;cancelCapture();audio.current.currentTime=Math.max(0,Math.min(time,source.duration));setCurrent(audio.current.currentTime);
 };
 const play=()=>{
  if(!enabled.current||!ready||!audio.current)return;
  audio.current.playbackRate=rate;
  const promise=audio.current.play();promise?.catch(()=>{setPlaying(false);message('Playback could not start. Try the native audio controls or reload your recording.',true);});
 };
 const referenceStarted=()=>{
  const element=audio.current;
  if(!enabled.current){element?.pause();return;}
  setPlaying(true);
  document.querySelectorAll('audio[data-lyric-reference]').forEach(other=>{if(other!==element)other.pause();});
  if(background?.getIsAudiblyPlaying?.()||background?.isPlaying){
   const failed=()=>{if(alive.current&&audio.current===element){element?.pause();message('Pause the main player before starting your lyric recording, so you hear only one song.',true);}};
   try{const pending=background.pause?.();pending?.catch?.(failed);}catch{failed();}
  }
 };
 const togglePlayback=()=>{if(playing)audio.current?.pause();else play();};
 const rehearse=()=>{if(isTime(selected?.time)){seek(Math.max(0,selected.time-2));play();}};
 const nudge=delta=>{
  if(!selected||!isTime(mode==='line'?selected.time:selected.words[selectedWord]?.time))return;cancelCapture();
  mutate(state=>({...state,lines:state.lines.map((line,index)=>{
   if(index!==selectedIndex)return line;
   if(mode==='line')return shiftTiming({...state,lines:[line]},delta).lines[0];
   return {...line,time:selectedWord===0&&isTime(line.time)?line.time+delta:line.time,words:line.words.map((word,j)=>j!==selectedWord?word:{...word,time:isTime(word.time)?word.time+delta:null,end:isTime(word.end)?word.end+delta:null})};
  })}));
 };
 const apply=()=>{
  const next={...editorModel(latest.current),reference:source.fingerprint,duration:source.duration};const issues=timingErrors(next,{requireReference:true});
  if(changed&&!reviewed)issues.push('Review these timings against the changed recording, then confirm the review.');
  if(!ready)issues.unshift('Wait for your recording to be ready, or retry if it needs attention.');
  if(issues.length){message(issues.join(' '),true);return;}
  try{emit(encodeLyrics(next));message(`Timings applied. ${saveHint}`);}catch(error){message(error.message,true);}
 };
 const importFile=async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{
   if(file.size>MAX_LYRIC_LENGTH*4)throw Error('The lyric file is too large.');
   const imported=await file.text();if(imported.length>MAX_LYRIC_LENGTH)throw Error('The lyric file is too large.');
   const parsed=editorModel(imported);if(parsed.error)throw Error(parsed.error);
   if(alive.current&&enabled.current){cancelCapture();setText(displayText(imported));emit(imported);setLineIndex(0);setWordIndex(0);message('Lyrics imported. Review their timing against your prepared recording.');}
  }catch(error){if(alive.current)message(error.message,true);}
 };
 const download=()=>{
  const blob=new Blob([value],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`${title.replace(/[^\p{L}\p{N} _-]/gu,'')||'lyrics'}.lrc`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const onKeyDown=event=>{
  if(disabled||editable(event.target))return;
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();moveHistory(event.shiftKey?'future':'past');return;}
  if(tab==='text')return;
  if(event.code==='Space'){
   if(event.target.tagName==='BUTTON')return;
   event.preventDefault();if(event.repeat||tab!=='timing')return;
   if(mode==='line')markLine();else startWord();return;
  }
  if(event.key==='Escape'){cancelCapture();audio.current?.pause();return;}
  if(event.repeat)return;
  if(event.key.toLowerCase()==='p'){event.preventDefault();togglePlayback();}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const delta=event.key==='ArrowLeft'?-1:1;if(event.shiftKey&&tab==='timing')nudge(delta*.05);else seek((audio.current?.currentTime||0)+delta*3);}
  if(tab==='timing'&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();navigate(event.key==='ArrowUp'?-1:1);}
 };
 const pointerDown=event=>{
  if(!enabled.current||!ready||!selected||event.isPrimary===false||event.button>0)return;
  event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture?.(event.pointerId);
  gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,time:audio.current.currentTime};if(mode==='word')startWord();
 };
 const pointerMove=event=>{
  const start=gesture.current;if(!start||start.id!==event.pointerId)return;
  if(Math.max(Math.abs(event.clientX-start.x),Math.abs(event.clientY-start.y))>14){start.moved=true;held.current=null;setCapturing(false);}
 };
 const pointerUp=event=>{
  const start=gesture.current;gesture.current=null;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;
  if(Math.abs(dx)>=50&&Math.abs(dx)>Math.abs(dy)*1.3){cancelCapture();navigate(dx<0?-1:1);return;}
  if(start.moved||Math.max(Math.abs(dx),Math.abs(dy))>14){cancelCapture();return;}
  if(mode==='line')markLine(start.time);else endWord();
 };
 const onTimeUpdate=event=>{
  const element=event.currentTarget;const start=isTime(selected?.time)?Math.max(0,selected.time-2):null;
  const end=interval?.end;
  if(loop&&start!=null&&end>start&&element.currentTime>=end){cancelCapture();element.currentTime=start;}
  setCurrent(element.currentTime);
 };
 const changeTab=next=>{cancelCapture();if(next==='text')audio.current?.pause();setTab(next);};
 const issueLine=issue=>{const match=issue.match(/^Line (\d+)/);if(match){selectLine(Number(match[1])-1);changeTab('timing');}};
 const timingStatus=changed?'Review recording':documentStatus==='No lyrics'?'Start here':documentStatus;

 return <fieldset disabled={disabled} className={styles.studio} aria-label={`${title} lyric editor`} onBlur={cancelCapture} onKeyDown={onKeyDown}
  onKeyUp={event=>{if(event.code==='Space'&&held.current){event.preventDefault();endWord();}}}>
  <legend className={styles.srOnly}>{title} lyrics</legend>
  <header className={styles.header}><div><div className={styles.eyebrow}>2MRRW / GLYPHS</div><h3 className={styles.heading}>Lyrics studio</h3><p className={styles.recording}>{title}</p></div><span className={styles.badge} data-state={applied?'ready':model.draft||changed?'draft':''}>{applied?<Icon name="check"/>:null}{timingStatus}</span></header>
  <nav className={styles.steps} aria-label="Lyric workflow">{[['text','Text','Write'],['timing','Synchronize','Time'],['preview','Preview','Preview']].map(([key,label,visible],index)=><button key={key} type="button" className={styles.step} aria-label={label} aria-pressed={tab===key} disabled={key!=='text'&&!model.lines.length} onClick={()=>changeTab(key)}><span className={styles.stepNumber}>{index+1}</span>{visible}</button>)}</nav>
  <div className={styles.body}>
   <div className={styles.tools}>
    <button type="button" className={styles.iconButton} aria-label="Undo" title="Undo · ⌘/Ctrl Z" disabled={!historyCounts.past} onClick={()=>moveHistory('past')}><Icon name="undo"/></button>
    <button type="button" className={styles.iconButton} aria-label="Redo" title="Redo · ⌘/Ctrl Shift Z" disabled={!historyCounts.future} onClick={()=>moveHistory('future')}><Icon name="redo"/></button>
    <button type="button" className={styles.button} onClick={()=>importer.current?.click()}><Icon name="upload"/>Import LRC</button><input ref={importer} className={styles.srOnly} tabIndex={-1} aria-label="Import lyrics" type="file" accept=".lrc,.txt,text/plain" onChange={importFile}/>
    <button type="button" className={styles.button} disabled={model.draft||!value} onClick={download}><Icon name="download"/>Export LRC</button>
    <button type="button" className={styles.button} disabled={value===baseline} onClick={()=>setDiscardPending(true)}>Discard lyric edits</button>
   </div>
   {discardPending?<div className={styles.tip} role="group" aria-label="Confirm discard lyric edits"><p>Return to {saveContext==='upload'?'the lyrics from when this recording was opened':'the last saved lyrics'}? You can undo this action.</p><div className={styles.adjustRow}><button type="button" className={styles.button} onClick={()=>setDiscardPending(false)}>Keep editing</button><button type="button" className={styles.secondary} onClick={()=>{cancelCapture();setText(displayText(baseline));emit(baseline);setDiscardPending(false);message('Lyric edits discarded. Undo can restore them.');}}>Discard changes</button></div></div>:null}
   {!source.url?<section className={styles.connect} aria-label="Recording preparation" role="status" data-recording-state={source.status}><Icon name="audio"/><h4>{source.status==='missing'?'Upload this recording’s audio first':source.status==='error'?'Your recording needs attention':'Preparing your recording…'}</h4><p>{source.status==='missing'?'Finish the audio upload earlier in this release, then return to lyrics.':source.status==='error'?'Your lyrics are retained. Retry this recording to reconnect the audio.':`Connecting ${title}. Play will be ready as soon as its audio is prepared.`}</p>{source.status==='error'?<button type="button" className={styles.primary} aria-label="Reload recording reference" onClick={loadReference}>Retry recording</button>:null}</section>:<div className={styles.transport} aria-label="Recording transport">
     <div className={styles.transportTop}><span className={styles.label}>{buffering?'Buffering recording…':ready?'Recording ready':source.status==='error'?'Recording needs attention':'Preparing audio…'}</span><span className={styles.clock}>{clock(current)} <small>/ {clock(source.duration)}</small></span></div>
     <div className={styles.transportControls}><button type="button" className={styles.iconButton} aria-label="Back 3 seconds" disabled={!ready} onClick={()=>seek((audio.current?.currentTime||0)-3)}><Icon name="left"/></button><button type="button" className={styles.playButton} aria-label={playing?'Pause reference':'Play reference'} disabled={!ready} onClick={togglePlayback}><Icon name={playing?'pause':'play'}/></button><button type="button" className={styles.iconButton} aria-label="Forward 3 seconds" disabled={!ready} onClick={()=>seek((audio.current?.currentTime||0)+3)}><Icon name="right"/></button><label className={styles.srOnly} htmlFor={`${uid}-speed`}>Playback speed</label><select id={`${uid}-speed`} className={styles.select} aria-label="Reference playback speed" value={rate} onChange={event=>{const next=Number(event.target.value);setRate(next);if(audio.current)audio.current.playbackRate=next;}}>{[0.5,0.75,1,1.25].map(speed=><option key={speed} value={speed}>{speed}× speed</option>)}</select></div>
     <div className={styles.seekWrap}><input className={styles.seek} aria-label="Recording position" aria-valuetext={`${clock(current)} of ${clock(source.duration)}`} type="range" min="0" max={source.duration||1} step="0.01" value={Math.min(current,source.duration||1)} disabled={!ready} onChange={event=>seek(Number(event.target.value))}/><div className={styles.cueMarks} aria-hidden="true">{model.lines.map((line,index)=>isTime(line.time)&&source.duration>0?<span key={index} className={styles.cueMark} style={{left:`${Math.min(100,line.time/source.duration*100)}%`}}/>:null)}</div></div><div className={styles.timelineCaption}><span>Scrub to any moment</span><span>Violet ticks = your lyric cues</span></div>
     <details className={styles.nativePlayer}><summary>Native audio controls</summary><audio data-lyric-reference key={source.fingerprint} ref={audio} controls={!disabled} preload="metadata" src={source.url}
      onLoadedMetadata={event=>{const element=event.currentTarget;const duration=Number.isFinite(element.duration)&&element.duration>0?element.duration:source.duration;element.playbackRate=rate;setCurrent(element.currentTime);if(isTime(duration)&&duration>0){setSource(previous=>({...previous,duration}));setMediaReady(true);}else message('The recording duration could not be read. Reload the recording.',true);}}
      onWaiting={()=>{setBuffering(true);cancelCapture();}} onPlaying={()=>setBuffering(false)} onCanPlay={()=>setBuffering(false)}
      onSeeking={cancelCapture} onTimeUpdate={onTimeUpdate} onSeeked={event=>{cancelCapture();setCurrent(event.currentTarget.currentTime);}}
      onPlay={referenceStarted}
      onPause={()=>{setPlaying(false);cancelCapture();}} onEnded={()=>{setPlaying(false);cancelCapture();}}
      onError={()=>{cancelCapture();setPlaying(false);setMediaReady(false);setSource(previous=>({...previous,status:'error'}));message('The recording could not play. Reload it, or use a browser that supports its audio format.',true);}}/></details>
     <button type="button" className={styles.button} aria-label="Reload recording reference" disabled={source.status==='loading'} onClick={loadReference}>Reload recording</button>
    </div>}
   {tab==='text'?<>
    <p className={styles.description}>Start with your words. Add timing when you’re ready.</p>
    <label className={styles.label} htmlFor={uid}>Your lyrics</label><textarea id={uid} aria-label={`${title} lyrics text`} className={styles.textArea} value={text} rows={10} maxLength={MAX_LYRIC_LENGTH} onChange={event=>changeText(event.target.value)} placeholder={'One sung line at a time.\nLeave a blank line between sections.\n\nYour words. Your timing.'}/>
    <div className={styles.textMeta}><span>{model.lines.length} lines · {totalWords} words</span><span>Line breaks stay with your lyrics</span></div>
    <div className={styles.guide}><div className={styles.guideItem}><span>01</span><div><strong>Write it as it’s sung</strong><p>One lyric line per row. Write repeated choruses in full.</p></div></div><div className={styles.guideItem}><span>02</span><div><strong>Listen. Tap. Follow.</strong><p>Tap each line’s first sung word. Word timing is optional editing precision.</p></div></div><div className={styles.guideItem}><span>03</span><div><strong>Hear it, then apply</strong><p>Preview against your recording before saving the release.</p></div></div></div>
    <div className={styles.nextRow}><span className={styles.note}>You can also save plain lyrics without timing.</span><button type="button" className={styles.primary} disabled={!model.lines.length} onClick={()=>changeTab('timing')}>Continue to timing <Icon name="right"/></button></div>
   </>:<div tabIndex={0} aria-label="Lyric synchronization workspace">
    {tab==='timing'?<>
     <div className={styles.timingGrid}><section className={styles.focusCard} aria-label="Capture lyrics">
      <div className={styles.focusTop}><span className={styles.lineCount}>LINE {selectedIndex+1} / {model.lines.length}</span><select className={styles.select} aria-label="Timing mode" value={mode} onChange={event=>{cancelCapture();setMode(event.target.value);setWordIndex(0);}}><option value="line">Line timing</option><option value="word">Word timing</option></select></div>
      <div className={styles.focusLyric} aria-label="Selected lyric">{selected?.text}</div>
      {mode==='word'&&selected?<div className={styles.wordChips} aria-label="Words in selected line">{selected.words.map((word,index)=><button key={index} type="button" className={styles.wordChip} aria-label={`Select line ${selectedIndex+1} word ${index+1}`} aria-pressed={index===selectedWord} data-complete={isTime(word.time)&&isTime(word.end)&&word.end>word.time} onClick={()=>{cancelCapture();setWordIndex(index);}}>{word.text}</button>)}</div>:null}
      <button type="button" className={styles.capturePad} data-capturing={capturing} aria-label={mode==='line'?'Mark selected line':'Hold to time selected word'} aria-describedby={`${uid}-capture-hint`} disabled={!ready||!selected}
       onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelCapture} onLostPointerCapture={cancelCapture}
       onClick={event=>{if(event.detail===0&&mode==='line')markLine();}}
       onKeyDown={event=>{if(event.code==='Space'){event.preventDefault();event.stopPropagation();if(!event.repeat){if(mode==='line')markLine();else startWord();}}}}
       onKeyUp={event=>{if(event.code==='Space'){event.preventDefault();event.stopPropagation();endWord();}}}>
       <Icon name="tap"/><span className={styles.captureTitle}>{capturing?'Release when the word ends':mode==='line'?'Sync this line':`Hold for “${selected?.words[selectedWord]?.text.trim()||'this word'}”`}</span><span id={`${uid}-capture-hint`} className={styles.captureHint}>{mode==='line'?'Play, then tap or press Space on the first sung word.':'Play, then hold Space or touch. Release at the word’s end.'}<br/>The next {mode==='line'?'line':'word'} advances automatically.</span>
      </button>
      <div className={styles.padFooter}><button type="button" aria-label="Previous lyric" onClick={()=>navigate(-1)} disabled={selectedIndex===0&&(mode==='line'||selectedWord===0)}><Icon name="left"/></button><span>Swipe left / right to move through {mode==='line'?'lines':'words'}</span><button type="button" aria-label="Next lyric" onClick={()=>navigate(1)} disabled={selectedIndex===model.lines.length-1&&(mode==='line'||selectedWord===selected?.words.length-1)}><Icon name="right"/></button></div>
      <div className={styles.rehearsal}><button type="button" className={styles.button} aria-label="Rehearse selected line" disabled={!ready||!isTime(selected?.time)} onClick={rehearse}><Icon name="play"/>Rehearse line</button><label><input type="checkbox" aria-label="Loop selected line" checked={loop} disabled={!ready||!isTime(selected?.time)} onChange={event=>{cancelCapture();setLoop(event.target.checked);}}/>Loop line</label></div>
     </section><aside className={styles.queue} aria-label="Lyric cue list"><div className={styles.queueHeader}><span>Your lyrics</span><span>{timedLines}/{model.lines.length} timed</span></div><div className={styles.queueList}>{model.lines.map((line,index)=><button key={index} ref={element=>{lineRefs.current[index]=element;}} type="button" className={styles.queueRow} aria-label={`Select line ${index+1}`} aria-pressed={index===selectedIndex} onClick={()=>selectLine(index)}><span className={styles.cueNumber}>{String(index+1).padStart(2,'0')}</span><span>{line.text}</span><span className={styles.cueTime} data-complete={isTime(line.time)}>{isTime(line.time)?clock(line.time).slice(0,5):'—'}</span></button>)}</div></aside></div>
     <progress className={styles.progressBar} value={progress} max={progressTotal||1} aria-label="Timing progress"/><p className={styles.note}>{progress} of {progressTotal} {mode==='word'?'words':'lines'} captured. {mode==='line'?'Start with lines; whole lines stay illuminated during playback.':'Hold each word for its actual sung length.'}</p>
     <details className={styles.adjust}><summary>Fine-tune selected {mode==='word'?'word':'line'}</summary><div className={styles.adjustBody}>
      <div className={styles.adjustRow}><button type="button" className={styles.button} aria-label="Nudge selected cue earlier" disabled={!isTime(mode==='line'?selected?.time:selected?.words[selectedWord]?.time)} onClick={()=>nudge(-.05)}>−50 ms</button><button type="button" className={styles.button} aria-label="Nudge selected cue later" disabled={!isTime(mode==='line'?selected?.time:selected?.words[selectedWord]?.time)} onClick={()=>nudge(.05)}>+50 ms</button><span className={styles.note}>Shift + ← / →</span></div>
      {selected?<label className={styles.label}>Line {selectedIndex+1} start<input className={styles.number} aria-label={`Line ${selectedIndex+1} start`} type="number" min="0" step="0.001" value={selected.time??''} onChange={event=>{const time=numeric(event.target.value);mutate(state=>({...state,lines:state.lines.map((line,index)=>index===selectedIndex?{...line,time}:line)}));}}/></label>:null}
      {mode==='word'&&selected?selected.words.map((word,index)=><div key={index} className={styles.wordEdit}><span>{word.text}</span>{['time','end'].map(field=><label key={field} className={styles.label}>{field==='time'?'Start':'End'}<input className={styles.number} aria-label={`Line ${selectedIndex+1} word ${index+1} ${field==='time'?'start':'end'}`} type="number" min="0" step="0.001" value={word[field]??''} onChange={event=>{const number=numeric(event.target.value);mutate(state=>({...state,lines:state.lines.map((line,i)=>i!==selectedIndex?line:{...line,...(index===0&&field==='time'?{time:number}:{}),words:line.words.map((word,j)=>j===index?{...word,[field]:number}:word)})}));}}/></label>)}</div>):null}
      <div className={styles.adjustRow}><label className={styles.label}>Shift every cue (seconds)<input className={styles.number} aria-label="Shift all timings" inputMode="decimal" value={offset} onChange={event=>setOffset(event.target.value)}/></label><button type="button" className={styles.button} onClick={()=>mutate(state=>shiftTiming(state,Number(offset)))}>Shift timings</button></div>
      <button type="button" className={styles.secondary} onClick={()=>mutate(state=>({...state,lines:state.lines.map(line=>({...line,time:null,words:wordsFor(line.text)}))}))}>Clear timings</button>
     </div></details>
     <div className={styles.nextRow}><span className={styles.note}>Listen back before you apply.</span><button type="button" className={styles.primary} onClick={()=>changeTab('preview')}>Preview lyrics <Icon name="right"/></button></div>
    </>:<>
     <p className={styles.description}>The whole line stays illuminated until the next timed line begins. The final phrase follows the recording to its end.</p>
     <div className={styles.reviewArt}>{coverUrl?<div className={styles.coverImage} style={{backgroundImage:`url(${JSON.stringify(coverUrl)})`}} aria-hidden="true"/>:null}<div className={styles.artScrim}/><div className={styles.reviewHeader}>GLYPHS / LISTENER PREVIEW</div><LyricTranscript key={`${releaseId}:${recordingId}`} lines={model.lines} activeIndex={activeLine} onSeek={ready?seek:undefined} preview label="Lyric playback preview"/></div>
     <div className={styles.checkList}><div className={styles.check} data-complete={!!model.lines.length}><Icon name="check"/>Lyrics added</div><div className={styles.check} data-complete={timedLines===model.lines.length&&!!model.lines.length}><Icon name="check"/>{timedLines} of {model.lines.length} lines timed</div><div className={styles.check} data-complete={ready&&!changed}><Icon name="audio"/>{ready?changed?'Recording changed — review needed':'Current recording ready':'Waiting for the recording to check your timing'}</div></div>
     {!hasTiming?<div className={styles.tip}><strong>Plain lyrics are ready.</strong> Timing is optional. {saveHint} Return to Time whenever you want to add synchronization.</div>:errors.length?<div className={styles.issues}><strong>A little more timing to finish</strong><ul>{errors.slice(0,6).map((issue,index)=><li key={index}>{/^Line \d+/.test(issue)?<button type="button" onClick={()=>issueLine(issue)}>{issue}</button>:issue}</li>)}</ul>{errors.length>6?<span>And {errors.length-6} more. Work through the remaining lines in Time.</span>:null}</div>:<div className={styles.tip}><strong>Your cues are ready to review.</strong> Play the recording and listen for every line’s first sung word. Rehearse any line that needs another pass.</div>}
    </>}
    <details className={styles.gestureGuide}><summary>Gesture & keyboard guide</summary><div className={styles.gestureList}>
     <div className={styles.gestureItem}><strong>Mark a line</strong><span>Tap capture pad / <kbd className={styles.kbd}>Space</kbd></span></div><div className={styles.gestureItem}><strong>Time a word</strong><span>Hold, then release / hold <kbd className={styles.kbd}>Space</kbd></span></div><div className={styles.gestureItem}><strong>Previous / next lyric</strong><span>Swipe left / right on pad · <kbd className={styles.kbd}>↑ ↓</kbd></span></div><div className={styles.gestureItem}><strong>Play / pause</strong><kbd className={styles.kbd}>P</kbd></div><div className={styles.gestureItem}><strong>Scrub 3 seconds</strong><kbd className={styles.kbd}>← →</kbd></div><div className={styles.gestureItem}><strong>Nudge 50 milliseconds</strong><kbd className={styles.kbd}>Shift + ← →</kbd></div><div className={styles.gestureItem}><strong>Undo / redo</strong><kbd className={styles.kbd}>⌘/Ctrl Z · ⌘/Ctrl Shift Z</kbd></div><div className={styles.gestureItem}><strong>Pause & cancel capture</strong><kbd className={styles.kbd}>Esc</kbd></div>
    </div><p className={styles.note}>Shortcuts work while this studio has focus. Typing in a text field keeps its normal behavior. Swipe on the capture pad; scroll anywhere else.</p></details>
   </div>}
   {changed?<label className={styles.reviewed}><input type="checkbox" aria-label="Reviewed changed recording" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>I reviewed these timings against the changed recording.</label>:null}
   {model.draft?<p className={styles.note} role="status">Unfinished timing is retained in your draft. Apply it before saving a released song or publishing.</p>:null}
   {notice?<p className={styles.notice} data-error={noticeError} role={noticeError?'alert':'status'}>{notice}</p>:null}
  </div>
  <footer className={styles.footer}>
   {draftSession||onSaveDraft?<div className={styles.draftStatus} role={saveState?.status==='error'||saveState?.status==='conflict'?'alert':'status'} aria-live="polite"><strong>{({loading:'Checking saved draft…',idle:'Draft saving is ready',saving:'Saving draft…',saved:'Draft saved',local:'Saved on this device · server sync pending',error:'Draft needs attention',conflict:'Draft versions need review'})[saveState?.status]||'Your upload draft saves automatically'}</strong>{saveState?.error?<span>{saveState.error}</span>:null}{saveState?.status==='conflict'&&draftSession?<div className={styles.adjustRow}>{saveState.canChoose?<><button type="button" className={styles.button} onClick={()=>draftSession.choose(true)}>Use saved draft</button><button type="button" className={styles.button} onClick={()=>draftSession.choose(false)}>Keep this draft</button></>:<button type="button" className={styles.button} onClick={()=>draftSession.review()}>Review saved draft</button>}</div>:null}</div>:null}
   <div className={styles.footerTop}><div className={styles.footerText}><strong>{applied?'Timings applied. One more step.':tab==='text'?'Your words, with room to move.':tab==='preview'&&!hasTiming?'Plain lyrics are ready.':'Capture → preview → apply'}</strong><span>{applied||tab==='preview'&&!hasTiming?saveHint:tab==='text'?'Save an unfinished draft at any time.':`${saveHint} Timing stays editable later.`}</span></div><div className={styles.footerButtons}><button type="button" className={styles.primary} disabled={(!draftSession&&!onSaveDraft)||saveState?.status==='saving'} onClick={()=>{const pending=draftSession?draftSession.save():onSaveDraft?.();pending?.catch?.(()=>{});}}>Save draft</button>{tab!=='text'?<><button type="button" className={styles.secondary} onClick={()=>{cancelCapture();const plain=plainLyrics(value);emit(plain);setText(plain);message('Timing removed. Your lyric text is retained.');}}>Keep text only</button><button type="button" className={styles.primary} disabled={!ready||!model.lines.length} onClick={apply}>Apply timings <Icon name="check"/></button></>:null}</div></div></footer>
 </fieldset>;
}
