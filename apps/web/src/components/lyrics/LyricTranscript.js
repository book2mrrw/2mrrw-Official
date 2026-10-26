"use client";

import {memo,useEffect,useRef,useState} from 'react';
import styles from './LyricTranscript.module.css';

const LyricLine=memo(function LyricLine({line,index,state,onSeek,preview}) {
  const seekable=typeof onSeek==='function'&&Number.isFinite(line.time)&&line.time>=0;
  const seek=()=>{if(seekable)onSeek(line.time);};
  return <p className={styles.line} data-lyric-line data-preview-lyric={preview?true:undefined}
    data-lyric-index={index} data-lyric-state={state} aria-current={state==='active'?'true':undefined}
    style={line.gapBefore?{marginTop:`${Math.min(line.gapBefore,4)*1.1}em`}:undefined}
    role={seekable?'button':undefined} tabIndex={seekable?0:undefined}
    aria-label={seekable?`Seek to lyric: ${line.text}`:undefined} onClick={seek}
    onKeyDown={event=>{if(seekable&&(event.key==='Enter'||event.key===' ')){event.preventDefault();seek();}}}>
    {line.text}
  </p>;
});

/** Presentation only. The existing player/reference supplies the active index.
 * Mount with a recording key so opening/changing recordings resets follow.
 */
export default function LyricTranscript({lines,activeIndex=-1,onSeek,reducedMotion=false,fullscreen=false,preview=false,label='Lyrics text'}) {
  const [follow,setFollow]=useState(true);
  const viewport=useRef(null);
  useEffect(()=>{
    if(!follow||activeIndex<0)return;
    const container=viewport.current;
    const line=container?.querySelector(`[data-lyric-index="${activeIndex}"]`);
    if(!line||!container)return;
    const position=()=>{
      const top=line.offsetTop,bottom=top+line.offsetHeight;
      const comfortableTop=container.scrollTop+container.clientHeight*.16;
      const comfortableBottom=container.scrollTop+container.clientHeight*.84;
      if(top>=comfortableTop&&bottom<=comfortableBottom)return;
      const reduce=reducedMotion||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      container.scrollTo?.({top:Math.max(0,top-container.clientHeight*.32),behavior:reduce?'auto':'smooth'});
    };
    const foreground=()=>{if(!document.hidden)position();};
    position();
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(position):null;
    observer?.observe(container);observer?.observe(line);
    if(!observer)window.addEventListener('resize',position);
    document.addEventListener('visibilitychange',foreground);
    return()=>{observer?.disconnect();window.removeEventListener('resize',position);document.removeEventListener('visibilitychange',foreground);};
  },[activeIndex,follow,reducedMotion,fullscreen]);
  const pauseFollow=()=>setFollow(false);
  const timed=lines.some(line=>Number.isFinite(line.time)&&line.time>=0);
  const activeStart=lines[activeIndex]?.time;
  return <div className={styles.transcript} data-fullscreen={fullscreen} data-lyric-mode="line">
    {!follow&&activeIndex>=0?<button type="button" className={styles.follow} onClick={()=>setFollow(true)}>Back to current lyric</button>:null}
    <div ref={viewport} className={styles.viewport} aria-label={label} tabIndex={0}
      onWheel={pauseFollow} onTouchMove={pauseFollow}
      onPointerDown={event=>{if(event.target===event.currentTarget)pauseFollow();}}
      onPointerMove={event=>{if(event.pointerType==='mouse'&&event.buttons===1)pauseFollow();}}
      onKeyDown={event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key))pauseFollow();}}>
      {lines.map((line,index)=><LyricLine key={index} line={line} index={index} preview={preview} onSeek={onSeek}
        state={index===activeIndex?'active':!timed?'plain':activeIndex>=0&&Number.isFinite(line.time)&&(line.time<activeStart||(line.time===activeStart&&index<activeIndex))?'previous':'upcoming'}/>)}
    </div>
  </div>;
}
