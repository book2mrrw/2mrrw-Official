"use client";
import {wordProgress} from '@/lib/lyrics/timing';
/** Same cue rendering in the authoring preview and consumer player. */
export default function TimedLyricWords({words,currentTime}){
 return words.map((word,index)=>{
  const progress=wordProgress(word,currentTime);
  return <span key={index} data-lyric-word aria-current={progress>0&&progress<1?'true':undefined} style={{whiteSpace:'pre-wrap',color:'transparent',backgroundClip:'text',WebkitBackgroundClip:'text',backgroundImage:`linear-gradient(to right, #fff ${progress*100}%, rgba(255,255,255,.55) ${progress*100}%)`}}>{word.text}</span>;
 });
}
