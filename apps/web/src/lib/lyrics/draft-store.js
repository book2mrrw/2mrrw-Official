import {decodeLyrics,MAX_LYRIC_LENGTH} from './timing.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(status,error)=>({status,body:{error}});
function outcome(result) {
  const {data,error}=result;
  if(!error)return {status:200,body:{ok:true,...data}};
  if(error.code==='40001')return fail(409,error.message);
  if(error.code==='22023')return fail(422,error.message);
  return fail(503,['PGRST202','42P01','PGRST205'].includes(error.code)?'Server draft saving is not available yet. Your device copy is retained.':'The lyric draft could not be saved or loaded. Your device copy is retained.');
}
export async function readLyricDraft(admin,actorId,releaseId,recordingId) {
  if(![actorId,releaseId,recordingId].every(value=>uuid.test(value||'')))return fail(400,'Valid release and recording identities are required.');
  return outcome(await admin.rpc('get_recording_lyric_draft',{p_actor_id:actorId,p_release_ref_id:releaseId,p_recording_id:recordingId}));
}
export async function saveLyricDraft(admin,actorId,releaseId,body) {
  if(![actorId,releaseId,body?.recording_id].every(value=>uuid.test(value||'')))return fail(400,'Valid release and recording identities are required.');
  if(body.expected_draft_revision!=null&&!uuid.test(body.expected_draft_revision))return fail(400,'Invalid draft revision.');
  if(typeof body.lyrics!=='string'||typeof body.base_lyrics!=='string'||body.lyrics.length>MAX_LYRIC_LENGTH||body.base_lyrics.length>MAX_LYRIC_LENGTH)return fail(422,'The lyric draft exceeds the text size limit.');
  const decoded=decodeLyrics(body.lyrics);
  if(decoded.error)return fail(422,decoded.error);
  return outcome(await admin.rpc('save_recording_lyric_draft',{p_actor_id:actorId,p_release_ref_id:releaseId,p_recording_id:body.recording_id,p_expected_draft_revision:body.expected_draft_revision??null,p_base_lyrics:body.base_lyrics,p_lyrics:body.lyrics}));
}
