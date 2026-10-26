import {createDraftSaveQueue} from '../credits/draft-save-queue.js';
import {MAX_LYRIC_LENGTH} from './timing.js';

export const lyricDraftKey=(author,release,recording)=>`2mrrw.lyric-draft.v1:${author}:${release}:${recording}`;

/** Private working copy, independent of published lyrics. Device writes are
 * synchronous; server writes are serialized/CAS-protected by the existing queue.
 */
export function createLyricWorkingDraft({authorId,releaseId,recordingId,baseline='',value='',storage,request=fetch,restore=()=>{},onState=()=>{},delay=3000}) {
  const key=lyricDraftKey(authorId,releaseId,recordingId),url=`/api/admin/releases/${encodeURIComponent(releaseId)}`;
  const draftUrl=`${url}?lyric_draft=${encodeURIComponent(recordingId)}&draft_owner=${encodeURIComponent(authorId)}`;
  let latest=value,local=null,revision=null,serverValue=baseline,available=false,conflict=false,remote=null,touched=false,timer=null,loading=null,disposed=false,controller=null,started=false,staleBase=false;
  let cachedLyrics;
  const notify=state=>onState({...state,cachedLyrics});
  const read=()=>{try{const data=JSON.parse(storage?.getItem(key)||'null');return data?.version===1&&typeof data.lyrics==='string'&&data.lyrics.length<=MAX_LYRIC_LENGTH&&typeof data.baseLyrics==='string'?data:null;}catch{return null;}};
  const cache=(intent=touched)=>{
    const record={version:1,lyrics:latest,baseLyrics:baseline,serverRevision:revision,updatedAt:Date.now(),intent};
    try{if(!storage)throw Error();storage.setItem(key,JSON.stringify(record));local=record;cachedLyrics=latest;return true;}catch{return false;}
  };
  const queue=createDraftSaveQueue({
    onState:state=>notify(state.status==='saved'?{status:latest===serverValue?'saved':'local'}:state),
    send:async(snapshot,expected,options)=>{
      const body=JSON.stringify({lyric_draft_version:1,draft_owner_id:authorId,recording_id:recordingId,expected_draft_revision:expected,base_lyrics:baseline,lyrics:snapshot.lyrics});
      const response=await request(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body,keepalive:options.keepalive===true&&new TextEncoder().encode(body).length<60000});
      let data=await response.json(),accepted=response.ok&&data.ok&&typeof data.revision==='string'&&data.revision.length>0;
      if(response.status===409){
        const check=await request(draftUrl,{cache:'no-store'}),current=await check.json();
        if(check.ok&&current.ok&&Object.hasOwn(current,'revision')&&(current.revision===null||typeof current.revision==='string')&&current.base_lyrics===baseline&&(current.draft?.lyrics??baseline)===snapshot.lyrics){data={ok:true,revision:current.revision};accepted=true;}
      }
      if(accepted){
        revision=data.revision;serverValue=snapshot.lyrics;
        const current=read();
        if(current){try{storage.setItem(key,JSON.stringify({...current,serverRevision:revision}));}catch{}}
        if(latest===snapshot.lyrics)cachedLyrics=latest; // Server durability also protects exit when device storage fails.
      }else if(response.status===409){conflict=true;available=false;}
      return {...data,ok:accepted,status:accepted?200:response.status,saved_at:data.revision};
    },
  });
  const schedule=()=>{
    clearTimeout(timer);
    if(available&&!conflict&&latest!==serverValue&&!disposed)timer=setTimeout(()=>flush().catch(()=>{}),delay);
  };
  const flush=async(options={})=>{
    clearTimeout(timer);
    if(!available||conflict)return false;
    if(latest===serverValue){notify({status:'saved'});return true;}
    try{await queue.enqueue({lyrics:latest},options);return true;}
    catch(error){notify({status:conflict?'conflict':'local',error:error.message});return false;}
  };
  const adopt=lyrics=>{latest=lyrics;restore(lyrics);cache();};
  const load=()=>{
    if(loading)return loading;
    const requestController=new AbortController();controller=requestController;
    const operation=(async()=>{
      try{
        const response=await request(draftUrl,{cache:'no-store',signal:requestController.signal});
        const data=await response.json();if(!response.ok||!data.ok||typeof data.base_lyrics!=='string'||!Object.hasOwn(data,'revision'))throw Error(data.error||'Server drafts are temporarily unavailable.');
        if(disposed||requestController.signal.aborted)return false;
        remote=data;revision=data.revision??null;
        if(data.base_lyrics!==baseline){conflict=true;notify({status:'conflict',error:'Published lyrics changed. Reopen this release; your device copy is retained.'});return false;}
        const working=local?.intent||local?.lyrics!==baseline&&!!local;
        if(staleBase||data.draft&&((working||touched)&&data.draft.lyrics!==latest&&local?.serverRevision!==revision||data.draft.base_lyrics!==baseline)){
          conflict=true;notify({status:'conflict',error:'Another saved version is available. Choose which draft to continue.',canChoose:true});return false;
        }
        available=true;conflict=false;queue.restoreRevision(revision);serverValue=data.draft?.lyrics??baseline;
        if(!working&&!touched&&data.draft)adopt(data.draft.lyrics);
        notify({status:latest===serverValue?(data.draft?'saved':'idle'):'local'});schedule();return true;
      }catch(error){
        if(disposed||requestController.signal.aborted)return false;
        available=false;const cached=cache();notify({status:cached?'local':'error',error:error.message});return false;
      }
    })();
    loading=operation;operation.finally(()=>{if(loading===operation)loading=null;}).catch(()=>{});return operation;
  };
  return {
    seed(lyrics){if(!started)latest=lyrics;},
    start(){
      disposed=false;started=true;if(controller?.signal.aborted)loading=null;
      local=read();
      if(local){
        revision=local.serverRevision??null;cachedLyrics=local.lyrics;
        if(local.lyrics!==latest){latest=local.lyrics;restore(latest);}
        if(local.baseLyrics!==baseline&&local.lyrics!==baseline){staleBase=true;conflict=true;notify({status:'conflict',error:'A device draft belongs to an earlier saved version. Review it before continuing.'});}
      }
      return load();
    },
    buffer(lyrics){
      latest=lyrics;touched=true;
      const cached=cache(true);notify({status:cached?'local':'error',error:cached?undefined:'Device recovery is unavailable. Use Save draft before leaving.'});schedule();
    },
    async save(){
      const cached=cache(true);touched=true;
      if(!available&&!conflict)await load();
      if(!available||conflict){if(!conflict)notify({status:cached?'local':'error',error:cached?'Saved on this device. Server sync is unavailable.':'Neither device recovery nor server saving is available. Keep this page open.'});return false;}
      return flush();
    },
    review:load,
    choose(useSaved){
      if(!remote||remote.base_lyrics!==baseline)return;
      conflict=false;staleBase=false;available=true;revision=remote.revision??null;queue.restoreRevision(revision);serverValue=remote.draft?.lyrics??baseline;
      if(useSaved)adopt(serverValue);
      touched=true;cache(true);notify({status:latest===serverValue?'saved':'local'});schedule();
    },
    dispose(){clearTimeout(timer);controller?.abort();flush({keepalive:true}).catch(()=>{});disposed=true;},
    flush,
  };
}
