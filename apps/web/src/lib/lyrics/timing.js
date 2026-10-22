// Shared lyric cue contract. Audio time is seconds on the full recording timeline.
const stampSource = '(\\d{1,4}):(\\d{2})(?:[.](\\d{1,3}))?';
const linePattern = new RegExp('\\[' + stampSource + '\\]', 'g');
const wordPattern = new RegExp('<' + stampSource + '>', 'g');
export const MAX_LYRIC_LENGTH = 250000;
const seconds = m => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 ** m[3].length : 0);
export const isTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function formatCue(value) {
  if (!isTime(value)) throw new Error('Cue time must be nonnegative and finite.');
  const ms = Math.round(value * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2,'0')}:${String(Math.floor(ms % 60000 / 1000)).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
export const wordsFor = text => (text.match(/\S+\s*/gu) || []).map(text => ({text, time:null, end:null}));
export function decodeLyrics(value = '') {
  const source = typeof value === 'string' ? value : '';
  if (source.length > MAX_LYRIC_LENGTH) return {lines:[],error:'Lyrics exceed the supported size.'};
  const first = source.split(/\r?\n/,1)[0];
  if (first.startsWith('[2mrrw-draft:') && first.endsWith(']')) {
    try {
      const draft = JSON.parse(first.slice(13,-1));
      if (!Array.isArray(draft.lines) || draft.lines.length > 2000 || draft.lines.some(l=>typeof l?.text!=='string'||!Array.isArray(l.words)||l.words.length>2000||l.words.some(w=>typeof w?.text!=='string'))) throw Error();
      return {...draft,draft:true};
    } catch { return {lines:[],draft:true,error:'The saved timing draft is malformed.'}; }
  }
  let reference=null,duration=null,error=null;
  const lines=[];const plainRows=[];let gap=0;
  for (const raw of source.split(/\r?\n/)) {
    const row=raw.trim();if(!row){gap++;plainRows.push('');continue;}
    if(row.startsWith('[2mrrw:')) {const m=row.match(/^\[2mrrw:1,([a-f0-9]{64}),([0-9.]+)\]$/);if(m){reference=m[1];duration=Number(m[2]);}else error='Malformed or unsupported lyric timing header.';continue;}
    if(/^\[(?:ar|ti|al|by|offset|length):.*\]$/i.test(row))continue;
    const matches=[...row.matchAll(linePattern)];
    const body=row.replace(linePattern,'');const tags=[...body.matchAll(wordPattern)];
    const text=body.replace(wordPattern,'').trim();if(!text)continue;plainRows.push(text);
    const tokens=tags.flatMap((m,i)=>{
      const word=body.slice(m.index+m[0].length,tags[i+1]?.index ?? body.length);
      return word.trim()?[{text:word,time:seconds(m),end:tags[i+1]?seconds(tags[i+1]):null}]:[];
    });
    const targets=matches.length?matches.map(seconds):[null];
    for(const time of targets) {lines.push({time,text,gapBefore:gap,...(tokens.length?{words:tokens}: {})});gap=0;}
  }
  return {lines,reference,duration,error,draft:false,plainText:plainRows.join('\n')};
}
export function editorModel(value) {
  const result=decodeLyrics(value);
  return {...result,lines:result.lines.map(line=>({...line,words:line.words || wordsFor(line.text)}))};
}
export function encodeDraft(model) {
  const text='[2mrrw-draft:'+JSON.stringify({...model,draft:true})+']\n'+model.lines.map(l=>l.text).join('\n');
  if(text.length>MAX_LYRIC_LENGTH)throw Error('Timing draft is too large.');return text;
}
export function timingErrors(model,{requireReference=false,duration=model.duration}={}) {
  const errors=[];let previous=-1;
  if(model.error)errors.push(model.error);
  if(!model.lines.length)errors.push('Add at least one lyric line.');
  if(model.lines.length>2000)errors.push('At most 2000 lyric lines are supported.');
  if(requireReference && !/^[a-f0-9]{64}$/.test(model.reference||''))errors.push('Load the recording reference before applying timing.');
  if(!isTime(duration)||duration<=0)errors.push('Load a valid recording duration.');
  model.lines.forEach((line,i)=>{
    if(typeof line.text!=='string'||!line.text.trim())errors.push(`Line ${i+1} needs text.`);
    if(!isTime(line.time))errors.push(`Line ${i+1} needs a start time.`);
    else {if(line.time<previous)errors.push(`Line ${i+1} starts before the previous line.`);previous=line.time;if(isTime(duration)&&line.time>=duration)errors.push(`Line ${i+1} starts outside the recording.`);}
    const timed=(line.words||[]).some(w=>w.time!=null||w.end!=null);
    if(!timed)return;
    let end=line.time;
    if(line.words.map(w=>w.text).join('').trim()!==line.text.trim())errors.push(`Line ${i+1} words do not match its text.`);
    line.words.forEach((word,j)=>{
      if(!isTime(word.time)||!isTime(word.end)||word.end<=word.time)errors.push(`Line ${i+1}, word ${j+1} needs ordered start/end times.`);
      else {if(word.time<end)errors.push(`Line ${i+1}, word ${j+1} overlaps the previous word.`);if(isTime(duration)&&word.end>duration)errors.push(`Line ${i+1}, word ${j+1} ends outside the recording.`);end=word.end;}
    });
    if(isTime(line.words[0]?.time)&&Math.abs(line.words[0].time-line.time)>.002)errors.push(`Line ${i+1} must start with its first word.`);
    const next=model.lines[i+1]?.time;if(isTime(next)&&isTime(end)&&end>next)errors.push(`Line ${i+1} words extend into the next line.`);
  });return [...new Set(errors)];
}
export function encodeLyrics(model) {
  const errors=timingErrors(model,{requireReference:true});if(errors.length)throw Error(errors.join(' '));
  const rows=model.lines.map(l=>{
    const timed=l.words?.some(w=>w.time!=null);
    const body=timed?l.words.map(w=>`<${formatCue(w.time)}>${w.text}<${formatCue(w.end)}>`).join(''):l.text;
    return '\n'.repeat(Math.min(20,l.gapBefore||0))+`[${formatCue(l.time)}]${body}`;
  });
  return `[2mrrw:1,${model.reference},${model.duration}]\n`+rows.join('\n');
}
export function validateLyricText(value) {
  if(typeof value!=='string'||value.length>MAX_LYRIC_LENGTH)return ['Lyrics must be text within the size limit.'];
  if(value.startsWith('[2mrrw-draft:'))return ['Apply or remove unfinished lyric timing before saving or publishing.'];
  const model=decodeLyrics(value);
  return model.error?[model.error]:model.reference?timingErrors(model,{requireReference:true}):[];
}
export function plainLyrics(value) {const model=decodeLyrics(value);return model.plainText ?? model.lines.map(l=>'\n'.repeat(Math.min(20,l.gapBefore||0))+l.text).join('\n');}
export function wordProgress(word,time) {
  if(!isTime(word.time)||!isTime(time)||time<word.time)return 0;
  if(!isTime(word.end)||word.end<=word.time)return 0;
  return Math.max(0,Math.min(1,(time-word.time)/(word.end-word.time)));
}
export function shiftTiming(model,delta) {
  if(!Number.isFinite(delta))throw Error('Enter a finite timing adjustment.');
  return {...model,lines:model.lines.map(l=>({...l,time:isTime(l.time)?l.time+delta:null,words:(l.words||[]).map(w=>({...w,time:isTime(w.time)?w.time+delta:null,end:isTime(w.end)?w.end+delta:null}))}))};
}
/** Match the audible recording, then convert a preview clip clock to full-recording time. */
export function lyricClock({currentTrack,releaseSlug,recording,isPreview,currentTime,previewStartSeconds}) {
  if(!currentTrack||!isTime(currentTime))return null;
  const meta=currentTrack.metadata||{};
  if((meta.albumSlug||currentTrack.slug)!==releaseSlug)return null;
  if(meta.albumSlug){
    const match=meta.trackSlug || currentTrack.trackSlug || String(currentTrack.id||'').split(':')[1];
    if(!match || ![recording?.slug,recording?.id,recording?.catalog_track_id].includes(match))return null;
  }
  const preview=typeof meta.access?.previewOnly==='boolean'?meta.access.previewOnly:isPreview;
  if(preview && !isTime(previewStartSeconds))return null;
  return currentTime+(preview?previewStartSeconds:0);
}

/** Shared authoring labels. Applied timing is not a claim that the release was saved. */
export function lyricStatus(value) {
  const model=decodeLyrics(value);
  if(model.error)return 'Needs attention';
  if(model.draft)return 'Timing draft';
  if(model.reference)return timingErrors(model,{requireReference:true}).length?'Needs attention':'Timing applied';
  if(model.lines.some(line=>line.time!=null||line.words?.some(word=>word.time!=null)))return 'Timing imported';
  return model.lines.length?'Text added':'No lyrics';
}
