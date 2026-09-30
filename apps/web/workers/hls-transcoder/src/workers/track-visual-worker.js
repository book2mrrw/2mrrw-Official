/** Dedicated process and queue; never claims or updates audio/Audio Visualz jobs. */
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { downloadStream, upload } from '../r2.js';
import { transcodeTrackVisual } from '../track-visual-transcoder.js';
import { dropPrivilegesIfRoot } from '../drop-privileges.js';

// /visual-scratch is this lane's mounted volume — root-owned the first time Fly
// attaches it, so it must be chowned before dropping, exactly as the video lane
// does for /data. This is not optional hardening: the Dockerfile deliberately
// omits USER so the video lane can chown its mount, so every lane starts as root
// and drops itself. Without this line the lane would run ffmpeg — over 5gb of
// untrusted, user-supplied media — as root. dropPrivilegesIfRoot is a no-op when
// already unprivileged and skips a chown path that does not exist, so this stays
// correct running locally with no volume attached.
dropPrivilegesIfRoot(['/visual-scratch']);

const workerId = `track-visual-${os.hostname()}-${crypto.randomUUID()}`;
let stopping = false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
while (!stopping) {
  let heartbeat;
  try {
    const claimed = await db.rpc('claim_track_visual_job',{p_worker_id:workerId});
    if (claimed.error) throw claimed.error;
    const job = claimed.data;
    if (!job) { await new Promise(r=>setTimeout(r,5000)); continue; }
    heartbeat = setInterval(()=>{void db.from('track_visual_jobs').update({heartbeat_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token).eq('status','processing').then(r=>{if(r.error)console.error('[track-visual] heartbeat failed',r.error.message);});},30000);
    let manifest=null,error=null;
    try { manifest=await transcodeTrackVisual({job,download:downloadStream,upload}); }
    catch(e){error=e.message;console.error('[track-visual] failed',job.id,error);}
    const result=await db.rpc('complete_track_visual_job',{p_job_id:job.id,p_lease_token:job.lease_token,p_manifest:manifest,p_error:error});
    if(result.error)throw result.error;
    console.info('[track-visual] completed',{job:job.id,published:result.data,failed:Boolean(error)});
  } catch(e){console.error('[track-visual] worker error',e.message);await new Promise(r=>setTimeout(r,5000));}
  finally{clearInterval(heartbeat);}
}
