"use client";

import { memo, useEffect, useState } from "react";
import { useAudioPlayer } from "@/context/AudioContext";

const formatTime = (s) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

function ModalAudioPlayer() {
  const { isPlaying, currentTime, duration, error, toggle, seek } = useAudioPlayer();
  const [localProgress, setLocalProgress] = useState({ current: 0, duration: 0 });

  useEffect(() => {
    setLocalProgress({ current: currentTime, duration });
  }, [currentTime, duration]);

  const seekTo = (e) => {
    if (!localProgress.duration) return;
    const rect  = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * localProgress.duration);
  };

  return (
    <div style={{width:"100%"}}>
      <div onClick={seekTo} style={{width:"100%",height:5,background:"#1e1e1e",borderRadius:3,cursor:"pointer",marginBottom:8,position:"relative"}}>
        <div style={{width:localProgress.duration?`${(localProgress.current/localProgress.duration)*100}%`:"0%",height:"100%",background:error?"#ff8a8a":"#00ffff",borderRadius:3,transition:"width 0.1s linear",boxShadow:error?"0 0 6px rgba(255,138,138,0.5)":"0 0 6px rgba(0,255,255,0.5)"}}/>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
        <span style={{fontSize:11,color:"#555",fontVariantNumeric:"tabular-nums",minWidth:34}}>{formatTime(localProgress.current)}</span>
        <button onClick={toggle} style={{width:44,height:44,borderRadius:"50%",background:error?"#333":"#00ffff",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,boxShadow:error?"none":"0 0 16px rgba(0,255,255,0.4)"}}>
          {isPlaying
            ? <svg viewBox="0 0 24 24" fill="#000" width="16" height="16"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
            : <svg viewBox="0 0 24 24" fill={error?"#aaa":"#000"} width="16" height="16" style={{marginLeft:2}}><path d="M8 5v14l11-7z"/></svg>}
        </button>
        <span style={{fontSize:11,color:"#555",fontVariantNumeric:"tabular-nums",minWidth:34,textAlign:"right"}}>{formatTime(localProgress.duration)}</span>
      </div>
      {error && <div style={{fontSize:11,color:"#ff8a8a",textAlign:"center",marginTop:8}}>{error}</div>}
    </div>
  );
}

export default memo(ModalAudioPlayer);
