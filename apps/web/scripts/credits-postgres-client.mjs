// SDK-shaped adapter used only by local PostgreSQL-backed component tests.
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw new Error('Invalid fixture SQL identifier');return `"${value}"`;};
export function creditFixtureClient(db){return {
 async rpc(name,args={}){
  const casts={p_release_ref_id:'uuid',p_release_id:'uuid',p_expected_revision:'jsonb',p_patch:'jsonb',p_payload:'jsonb',p_expected_saved_at:'timestamptz',p_step_index:'int'};
  const entries=Object.entries(args);try{
   const result=await db.query(`SELECT public.${identifier(name)}(${entries.map(([k],i)=>`${identifier(k)}=>$${i+1}${casts[k]?'::'+casts[k]:''}`).join(',')}) AS data`,entries.map(([k,v])=>casts[k]==='jsonb'?JSON.stringify(v):v));return {data:result.rows[0].data,error:null};
  }catch(error){return {data:null,error};}
 },
 from(table){
  let filters=[],orders=[],limit=null,columns='*',insert=null;
  const result=async(single=false)=>{try{
   const params=[];let sql;
   if(insert){const keys=Object.keys(insert);sql=`INSERT INTO public.${identifier(table)}(${keys.map(identifier)}) VALUES(${keys.map((_,i)=>'$'+(i+1))}) RETURNING ${columns}`;params.push(...Object.values(insert));}
   else{sql=`SELECT ${columns} FROM public.${identifier(table)}`;if(filters.length)sql+=' WHERE '+filters.map(f=>{params.push(f.value);return `${identifier(f.key)} IS NOT DISTINCT FROM $${params.length}`;}).join(' AND ');if(orders.length)sql+=' ORDER BY '+orders.map(o=>`${identifier(o.key)} ${o.asc?'ASC':'DESC'}`).join(',');if(limit!=null)sql+=` LIMIT ${Number(limit)}`;}
   const rows=(await db.query(sql,params)).rows;
   if(single&&rows.length>1)throw new Error('Multiple fixture records');
   return {data:single?rows[0]||null:rows,error:null};
  }catch(error){return {data:null,error};}};
  const q={select(value='*'){columns=value==='*'?'*':value.split(',').map(v=>identifier(v.trim())).join(',');return q;},eq(key,value){filters.push({key,value});return q;},is(key,value){filters.push({key,value});return q;},order(key,options={}){orders.push({key,asc:options.ascending!==false});return q;},limit(value){limit=value;return q;},insert(value){insert=value;return q;},single:()=>result(true),maybeSingle:()=>result(true),then(resolve,reject){return result().then(resolve,reject);}};return q;
 }
};}
