import {verifyLyricInput} from './audio-source.js';
export async function commitLyricEdit(admin,id,body){
 if(!body.revision||typeof body.revision!=='object'||!Array.isArray(body.track_lyrics))return {status:422,body:{error:'Saved revision and recording lyrics are required.'}};
 const ids=new Set();
 try{
  for(const row of body.track_lyrics){if(!row?.id||ids.has(row.id))return {status:422,body:{error:'Each lyric recording needs a unique saved identity.'}};ids.add(row.id);await verifyLyricInput(admin,id,row.id,row.lyrics);}
 }catch(error){return {status:error.status||503,body:{error:error.status?error.message:'Recording timing could not be verified.'}};}
 const {data,error}=await admin.rpc('commit_release_lyric_edit',{p_release_ref_id:id,p_expected_revision:body.revision,p_lyrics:body.track_lyrics});
 if(error)return {status:error.code==='40001'?409:error.code==='22023'?422:error.code==='PGRST202'?503:500,body:{error:error.code==='40001'?'This release changed. Reopen it before saving; your entered lyrics are retained.':error.code==='PGRST202'?'Lyric editing requires the reviewed database contract.':error.code==='22023'?error.message:'Lyrics could not be saved. No partial edit was committed.'}};
 return {status:200,body:{ok:true,revision:data.revision},result:data};
}
