import {createHash} from 'node:crypto';
import {getR2ObjectMetadata, listR2Objects} from '@/lib/storage/r2';
import {validateAudioSourceKey} from '@/lib/media/audio-source-key';
import {decodeLyrics, plainLyrics, validateLyricText} from './timing.js';
const extensions=['.wav','.wave','.flac','.mp3','.m4a','.aiff','.aif'];
export class LyricSourceError extends Error {constructor(message,status=422){super(message);this.status=status;}}
export function audioFingerprint(id,metadata) {
  if(!metadata?.etag || !Number.isFinite(metadata.contentLength))throw new LyricSourceError('Recording reference could not be verified.',503);
  // Deliberately excludes object path: publication may copy the same recording into its catalog folder.
  return createHash('sha256').update(JSON.stringify([id,metadata.etag,metadata.contentLength])).digest('hex');
}
// Promoted revisions own their duration through the manifest committed with that exact master.
// tracks.duration_seconds and legacy metadata can still describe the previous recording.
async function currentSourceDuration(admin,kind,id,key) {
  const {data:revision,error}=await admin.from('audio_master_revisions').select('hls_prefix')
    .eq('entity_kind',kind).eq('entity_id',id).eq('staged_master_key',key).eq('status','active').maybeSingle();
  if(error){
    // Some frontend projects have not installed the optional replacement pipeline yet.
    if(['42P01','PGRST205'].includes(error.code))return null;
    throw new LyricSourceError('Recording duration could not be verified.',503);
  }
  if(!revision)return null; // Unbound historical duration is advisory; the author reads this exact audio's metadata.
  const result=await admin.from('hls_manifests').select('duration_seconds').eq('hls_prefix',revision.hls_prefix).maybeSingle();
  const duration=Number(result.data?.duration_seconds);
  if(result.error||!Number.isFinite(duration)||duration<=0)throw new LyricSourceError('The active recording duration is unavailable.',503);
  return duration;
}
export async function resolveLyricAudio(admin,ref,id) {
  const releaseResult=await admin.from('releases').select('id').eq('id',ref).is('deleted_at',null).maybeSingle();
  if(releaseResult.error)throw new LyricSourceError('Could not load the recording.',503);
  let key,target=id,duration=null,kind='track';
  if(releaseResult.data){
    const result=await admin.from('tracks').select('id,audio_r2_key,master_r2_key').eq('id',id).eq('release_id',ref).is('removed_from_release_at',null).maybeSingle();
    if(result.error)throw new LyricSourceError('Could not load the recording.',503);
    if(!result.data)throw new LyricSourceError('Recording not found in this release.',404);
    key=result.data.audio_r2_key||result.data.master_r2_key;
  }else{
    const result=await admin.from('products').select('id,release_id,product_type,storage_path,metadata').eq('id',ref).is('deleted_at',null).maybeSingle();
    if(result.error)throw new LyricSourceError('Could not load the release.',503);
    const product=result.data;if(!product)throw new LyricSourceError('Release not found.',404);
    if(product.release_id)return resolveLyricAudio(admin,product.release_id,id);
    let row=product;kind='product';
    if(id!==product.id){
      const child=await admin.from('catalog_tracks').select('id,storage_path,metadata').eq('id',id).eq('product_id',product.id).is('removed_from_release_at',null).maybeSingle();
      if(child.error)throw new LyricSourceError('Could not load the recording.',503);
      if(!child.data)throw new LyricSourceError('Recording not found in this release.',404);row=child.data;kind='catalog_track';
    }else if(!['single','feature'].includes(product.product_type))throw new LyricSourceError('Select a recording.',422);
    key=row.metadata?.audio_key || row.metadata?.master_r2_key;
    if(!key){
      const storage=String(row.storage_path||'');
      if(extensions.some(e=>storage.toLowerCase().endsWith(e)))key=storage;
      else if(storage){const folder=storage.replace(/\/$/,'')+'/';const candidates=[...new Set((await listR2Objects(folder,{recursive:false})).map(o=>o.Key).filter(k=>k?.startsWith(folder)&&!k.slice(folder.length).includes('/')&&extensions.some(e=>k.toLowerCase().endsWith(e))))];
        if(candidates.length!==1)throw new LyricSourceError('Set an unambiguous recording master before synchronizing.',409);key=candidates[0];}
    }
  }
  if(!key)throw new LyricSourceError('Upload the recording audio before synchronizing lyrics.',409);
  try{key=validateAudioSourceKey(key);}catch{throw new LyricSourceError('A full recording master is required for lyric timing.');}
  const metadata=await getR2ObjectMetadata(key);
  if(!metadata)throw new LyricSourceError('Recording audio is unavailable.',404);
  duration=await currentSourceDuration(admin,kind,target,key);
  return {id:target,key,metadata,duration,fingerprint:audioFingerprint(target,metadata)};
}
export async function verifyLyricInput(admin,ref,id,lyrics) {
  const errors=validateLyricText(lyrics);if(errors.length)throw new LyricSourceError(errors.join(' '));
  const model=decodeLyrics(lyrics);if(!model.reference)return null;
  const source=await resolveLyricAudio(admin,ref,id);
  if(source.fingerprint!==model.reference)throw new LyricSourceError('The recording audio changed. Review and reapply its lyric timings.',409);
  if(source.duration && model.lines.some(l=>l.time>=source.duration || l.words?.some(w=>w.end>source.duration)))throw new LyricSourceError('Lyric timing extends beyond the recording.');
  return source;
}
export async function publicLyricTiming(admin,ref,id,lyrics) {
  const model=decodeLyrics(lyrics);
  if(model.draft || validateLyricText(lyrics).length)return {lyrics:plainLyrics(lyrics),sync_status:'invalid'};
  if(!model.reference)return {lyrics,sync_status:model.draft?'draft':'legacy'};
  try{
    const source=await resolveLyricAudio(admin,ref,id);
    if(source.fingerprint===model.reference)return {lyrics,sync_status:'verified'};
    return {lyrics:plainLyrics(lyrics),sync_status:'audio_changed'};
  }catch{return {lyrics:plainLyrics(lyrics),sync_status:'unavailable'};}
}
/** Publication only: rebind a verified document after a server-owned byte-for-byte storage copy. */
export async function rebindCopiedLyrics(lyrics,id,key){
 const model=decodeLyrics(lyrics);if(!model.reference)return lyrics;
 const metadata=await getR2ObjectMetadata(key);
 const fingerprint=audioFingerprint(id,metadata);
 return lyrics.replace(/^\[2mrrw:1,[a-f0-9]{64},/,`[2mrrw:1,${fingerprint},`);
}
