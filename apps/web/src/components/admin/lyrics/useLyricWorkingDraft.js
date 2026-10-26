"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {createLyricWorkingDraft} from '@/lib/lyrics/working-draft';

export default function useLyricWorkingDraft({authorId,releaseId,recordingId,value,baseline,onChange,onDraftState,enabled}) {
  const [state,setState]=useState({status:'loading'});
  const callbacks=useRef({onChange,onDraftState}),alive=useRef(false);
  useEffect(()=>{callbacks.current={onChange,onDraftState};},[onChange,onDraftState]);
  const session=useMemo(()=>{
    if(!enabled||!authorId||!releaseId||!recordingId)return null;
    const storage={getItem:key=>window.localStorage.getItem(key),setItem:(key,data)=>window.localStorage.setItem(key,data)};
    return createLyricWorkingDraft({authorId,releaseId,recordingId,baseline,value:baseline,storage,
      restore:lyrics=>{if(alive.current)callbacks.current.onChange(lyrics);},
      onState:next=>{if(alive.current){setState(next);callbacks.current.onDraftState?.(next);}},
    });
  },[enabled,authorId,releaseId,recordingId,baseline]);
  useEffect(()=>{session?.seed(value);},[session,value]);
  useEffect(()=>{
    alive.current=true;
    if(!session)return()=>{alive.current=false;};
    session.start();const flush=()=>session.flush({keepalive:true}).catch(()=>{}),reconnect=()=>session.save().catch(()=>{});
    window.addEventListener('pagehide',flush);
    window.addEventListener('online',reconnect);
    return()=>{alive.current=false;window.removeEventListener('pagehide',flush);window.removeEventListener('online',reconnect);session.dispose();};
  },[session]);
  return {session,state};
}
