-- Database-only verification. Every fixture write is rolled back by the inner
-- subtransaction. No R2 request, queue command or real release is involved.
DO $verify$
DECLARE
 rid uuid=gen_random_uuid(); aid uuid=gen_random_uuid(); bid uuid=gen_random_uuid();
 album text='codex-lyrics-probe-'||rid::text; pid uuid; cid uuid;
 doc_a text='[00:01.000]One lyric'||E'\n'||'[00:08.000]Next one';
 doc_b text='[00:02.000]Two lyric'||E'\n'||'[00:09.000]Next two';
 payload jsonb; result jsonb; stale jsonb; activated boolean; failed boolean;
BEGIN
 BEGIN
  INSERT INTO public.releases(id,title,slug,status,release_type,content_kind,cover_art_r2_key)
   VALUES(rid,album,album,'draft','album','music','verification/cover.webp');
  INSERT INTO public.tracks(id,release_id,title,position,upload_status,audio_r2_key,lyrics)
   VALUES(aid,rid,'One',1,'ready','verification/one.wav',doc_a),(bid,rid,'Two',2,'ready','verification/two.wav',doc_b);
  payload=jsonb_build_object(
   'product',jsonb_build_object('slug',album,'title',album,'release_id',rid,'content_kind','music','product_type','album','release_type','albums','price_cents',100,'active',false,'metadata','{}'::jsonb),
   'release',jsonb_build_object('slug',album,'status','scheduled','available_at',now()+interval '1 day','storefront_visible',false),
   'recordings',jsonb_build_array(jsonb_build_object('id',aid,'position',1,'lyrics',doc_a),jsonb_build_object('id',bid,'position',2,'lyrics',doc_b)),
   'catalog_tracks',jsonb_build_array(
    jsonb_build_object('track_id',aid,'album_slug',album,'slug','one','title','One','track_number',1,'position',1,'lyrics',doc_a),
    jsonb_build_object('track_id',bid,'album_slug',album,'slug','two','title','Two','track_number',2,'position',2,'lyrics',doc_b)));
  -- Capture a real pre-publication token. Live updated_at triggers use now(),
  -- so multiple calls inside this rollback transaction share one timestamp.
  stale=public._credit_revision(rid);
  result=public.commit_release_publication(rid,stale,payload);
  pid=(result->>'product_id')::uuid;
  payload=jsonb_set(payload,'{recordings,0,position}','2');payload=jsonb_set(payload,'{recordings,1,position}','1');
  payload=jsonb_set(payload,'{catalog_tracks,0,position}','2');payload=jsonb_set(payload,'{catalog_tracks,0,track_number}','2');
  payload=jsonb_set(payload,'{catalog_tracks,1,position}','1');payload=jsonb_set(payload,'{catalog_tracks,1,track_number}','1');
  PERFORM public.commit_release_publication(rid,public._credit_revision(rid),payload);
  IF (SELECT ct.track_id FROM public.catalog_tracks ct WHERE ct.product_id=pid ORDER BY ct.position LIMIT 1) IS DISTINCT FROM bid THEN RAISE EXCEPTION 'Swap did not commit';END IF;
  failed=false;
  BEGIN PERFORM public.commit_release_publication(rid,stale,payload);
  EXCEPTION WHEN serialization_failure THEN failed=true;END;
  IF NOT failed THEN RAISE EXCEPTION 'Stale revision accepted';END IF;
  SELECT a.activated INTO activated FROM public.activate_scheduled_release(rid,now()+interval '2 days') a;
  IF NOT activated OR NOT (SELECT p.active FROM public.products p WHERE p.id=pid) THEN RAISE EXCEPTION 'Activation failed';END IF;
  IF (SELECT t.lyrics FROM public.tracks t WHERE t.id=aid) IS DISTINCT FROM doc_a
   OR (SELECT t.lyrics FROM public.tracks t WHERE t.id=bid) IS DISTINCT FROM doc_b
   OR (SELECT ct.lyrics FROM public.catalog_tracks ct WHERE ct.product_id=pid AND ct.track_id=aid) IS DISTINCT FROM doc_a
   OR (SELECT ct.lyrics FROM public.catalog_tracks ct WHERE ct.product_id=pid AND ct.track_id=bid) IS DISTINCT FROM doc_b THEN RAISE EXCEPTION 'Cue documents changed';END IF;
  SELECT ct.id INTO cid FROM public.catalog_tracks ct WHERE ct.product_id=pid AND ct.track_id=bid;
  result=public.remove_release_track(pid,cid);
  IF result->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM public.tracks t WHERE t.id=bid AND t.removed_from_release_at IS NOT NULL) THEN RAISE EXCEPTION 'Removal did not preserve both identities';END IF;
  payload=jsonb_set(payload,'{release}',(SELECT to_jsonb(r) FROM public.releases r WHERE r.id=rid));
  payload=jsonb_set(payload,'{product}',(SELECT to_jsonb(p) FROM public.products p WHERE p.id=pid));
  payload=jsonb_set(payload,'{recordings}',jsonb_build_array(jsonb_build_object('id',aid,'position',1,'lyrics',doc_a)));
  payload=jsonb_set(payload,'{catalog_tracks}',jsonb_build_array(jsonb_build_object('track_id',aid,'album_slug',album,'slug','one','title','One','track_number',1,'position',1,'lyrics',doc_a)));
  PERFORM public.commit_release_publication(rid,public._credit_revision(rid),payload);
  IF (SELECT ct.track_number FROM public.catalog_tracks ct WHERE ct.product_id=pid AND ct.track_id=aid) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Compaction failed';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.catalog_tracks ct WHERE ct.id=cid AND ct.removed_from_release_at IS NOT NULL AND ct.lyrics=doc_b) THEN RAISE EXCEPTION 'Removed recording history changed';END IF;
  RAISE EXCEPTION 'Rollback successful verification fixtures' USING ERRCODE='ZV001';
 EXCEPTION WHEN SQLSTATE 'ZV001' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.releases r WHERE r.id=rid) OR EXISTS(SELECT 1 FROM public.products p WHERE p.id=pid)
   OR EXISTS(SELECT 1 FROM public.tracks t WHERE t.id IN (aid,bid)) THEN RAISE EXCEPTION 'Verification fixtures were retained';END IF;
END;
$verify$;
SELECT 'passed: scheduled activation, exact cue retention, swap, stale-write rejection, both removal identities, compaction and rollback' AS verification,
 (SELECT count(*) FROM public.releases WHERE slug LIKE 'codex-lyrics-probe-%') AS retained_fixture_releases;
