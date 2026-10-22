import {NextResponse} from 'next/server';
import {getAdminSessionUser} from '@/lib/auth/admin-api-guard';
import {isAdminUser} from '@/lib/auth/constants';
import {getAdminClient} from '@/lib/supabase/admin';
import {checkRateLimit,rateLimitResponse} from '@/lib/server/rate-limit';
import {createR2SignedGetUrl} from '@/lib/storage/r2';
import {proxySignedR2Get} from '@/lib/server/r2-stream-proxy';
import {resolveLyricAudio} from '@/lib/lyrics/audio-source';
export const dynamic='force-dynamic';
export async function GET(req,{params}){
 const user=await getAdminSessionUser();if(!user||!isAdminUser(user))return NextResponse.json({error:'Unauthorized'},{status:401});
 const limit=await checkRateLimit(req,{routeKey:'admin.lyrics.audio',limit:120,windowSeconds:60,identifier:user.id});if(!limit.allowed)return rateLimitResponse(limit.retryAfterSeconds);
 const {id,trackId}=await params;
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(id)||!uuid.test(trackId))return NextResponse.json({error:'Valid release and recording IDs are required.'},{status:400});
 try{
  const source=await resolveLyricAudio(getAdminClient(),id,trackId);const url=new URL(req.url);
  if(url.searchParams.get('metadata')==='1')return NextResponse.json({fingerprint:source.fingerprint,duration:source.duration},{headers:{'Cache-Control':'private, no-store'}});
  if(url.searchParams.get('revision')!==source.fingerprint)return NextResponse.json({error:'Recording audio changed. Reload the reference.'},{status:409});
  if(req.method==='HEAD')return new Response(null,{headers:{'Content-Type':source.metadata.contentType||'application/octet-stream','Content-Length':String(source.metadata.contentLength),'Accept-Ranges':'bytes','Cache-Control':'private, no-store'}});
  // The signed URL never leaves the server. Every range request traverses the admin gate above.
  const signed=await createR2SignedGetUrl(source.key,60);
  return proxySignedR2Get(req,signed,{cacheControl:'private, no-store',opaqueErrors:true,upstreamHeaders:{'If-Match':source.metadata.etag}});
 }catch(error){return NextResponse.json({error:error.status?error.message:'Recording audio could not be loaded.'},{status:error.status||503});}
}
